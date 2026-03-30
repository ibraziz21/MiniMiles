/**
 * setBatchBlacklist.ts
 *
 * One-shot script to batch-blacklist bot wallets on AkibaMilesV2.
 * Reads black-list.json, filters out low-risk entries, then calls
 * batchSetBlacklist() on-chain in chunks.
 *
 * Filter rule — skip (do NOT blacklist) wallets where ALL of:
 *   partner_count < 2  AND  profile_milestone_50_claimed == false
 *                      AND  profile_milestone_100_claimed == false
 *
 * .env required (reads react-app/.env by default):
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_KEY=
 *   DRAIN_PK=             (private key of an address with onlyAllowed on V2)
 *   MINIPOINTS_V2_ADDRESS= (optional, defaults to known address)
 *
 * Run:
 *   cd packages/backend
 *   npx ts-node --require dotenv/config src/setBatchBlacklist.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: require("path").resolve(__dirname, "../../react-app/.env") });
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { supabase } from "./supabaseClient";

// ── Config ────────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS =
  process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";
const BATCH_SIZE = 500;
const TX_TIMEOUT_MS = 90_000;
const DRY_RUN = process.env.DRY_RUN === "true";

const BATCH_BLACKLIST_ABI = [
  "function batchSetBlacklist(address[] calldata accounts, bool blacklisted) external",
];

interface BotEntry {
  user_address: string;
  partner_count: number;
  daily_count: number;
  profile_milestone_50_claimed: boolean;
  profile_milestone_100_claimed: boolean;
  first_activity: string;
  last_activity: string;
  window_minutes: string | number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function shouldBlacklist(entry: BotEntry): boolean {
  // Skip low-risk: few partner claims and no profile milestones
  if (
    entry.partner_count < 2 &&
    !entry.profile_milestone_50_claimed &&
    !entry.profile_milestone_100_claimed
  ) {
    return false;
  }
  return true;
}

const RPC_URLS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
];

function makeProvider() {
  // Use a single primary RPC for sending; waitForReceipt handles multi-RPC polling
  return new ethers.JsonRpcProvider(RPC_URLS[0]);
}

async function waitForReceipt(txHash: string, timeoutMs: number): Promise<ethers.TransactionReceipt> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const url of RPC_URLS) {
      try {
        const p = new ethers.JsonRpcProvider(url);
        const receipt = await p.getTransactionReceipt(txHash);
        if (receipt && receipt.status != null) return receipt;
      } catch {
        // try next RPC
      }
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Receipt not found for ${txHash} after ${timeoutMs}ms`);
}

function makeWallet() {
  const pk = process.env.DRAIN_PK;
  if (!pk) throw new Error("DRAIN_PK not set");
  const provider = makeProvider();
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, BATCH_BLACKLIST_ABI, wallet);
  console.log(`[blacklist] Wallet: ${wallet.address}`);
  return { wallet, contract };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const listPath = path.resolve(__dirname, "black-list.json");
  if (!fs.existsSync(listPath)) {
    throw new Error(`black-list.json not found at ${listPath}`);
  }

  console.log("[blacklist] Loading black-list.json…");
  const raw: BotEntry[] = JSON.parse(fs.readFileSync(listPath, "utf-8"));
  console.log(`[blacklist] Total entries in file: ${raw.length}`);

  const filtered = raw.filter(shouldBlacklist);
  const toBlacklist = filtered.map((e) => e.user_address.toLowerCase());
  const skippedEntries = raw.filter((e) => !shouldBlacklist(e));
  const skipped = skippedEntries.length;

  console.log(`[blacklist] After filter: ${toBlacklist.length} to blacklist, ${skipped} skipped`);

  if (toBlacklist.length === 0) {
    console.log("[blacklist] Nothing to do.");
    return;
  }

  const outputPath = path.resolve(__dirname, "blacklist-result.json");
  const skippedPath = path.resolve(__dirname, "blacklist-skipped.json");
  fs.writeFileSync(skippedPath, JSON.stringify(skippedEntries, null, 2));
  console.log(`[blacklist] Skipped list written to blacklist-skipped.json (${skippedEntries.length} entries)`);

  if (DRY_RUN) {
    console.log("[blacklist] DRY_RUN=true — writing preview to blacklist-result.json…");
    const output = {
      generated_at: new Date().toISOString(),
      dry_run: true,
      would_blacklist_count: toBlacklist.length,
      skipped_count: skipped,
      would_blacklist: filtered.map((e) => ({ ...e, blacklisted: false, skipped: false })),
      skipped: skippedEntries.map((e) => ({ ...e, blacklisted: false, skipped: true })),
    };
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`[blacklist] Preview written to ${outputPath}`);
    return;
  }

  // ── 1. Load local progress file (resume support) ──────────────────────────
  const progressPath = path.resolve(__dirname, "blacklist-progress.json");
  let alreadyDone = new Set<string>();

  if (fs.existsSync(progressPath)) {
    try {
      const saved: string[] = JSON.parse(fs.readFileSync(progressPath, "utf-8"));
      alreadyDone = new Set(saved.map((a) => a.toLowerCase()));
      console.log(`[blacklist] Resuming: ${alreadyDone.size} already done from previous run`);
    } catch {
      console.warn("[blacklist] Could not parse progress file, starting fresh");
    }
  }

  const remaining = toBlacklist.filter((a) => !alreadyDone.has(a));
  console.log(`[blacklist] Remaining to process: ${remaining.length}`);

  if (remaining.length === 0) {
    console.log("[blacklist] All addresses already blacklisted. Nothing to do.");
    return;
  }

  // ── 2. On-chain batchSetBlacklist ─────────────────────────────────────────
  console.log("\n[blacklist] Starting on-chain batchSetBlacklist…");
  const { wallet, contract } = makeWallet();

  const batches = chunk(remaining, BATCH_SIZE);
  const succeededAddresses: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`\n[blacklist] Batch ${i + 1}/${batches.length}: ${batch.length} addresses`);

    const MAX_NONCE_RETRIES = 3;
    let txHash: string | undefined;
    let sent = false;

    for (let attempt = 1; attempt <= MAX_NONCE_RETRIES; attempt++) {
      try {
        const overrides: Record<string, any> = {};
        if (attempt > 1) {
          // Fetch fresh nonce from chain to recover from stale/used nonce
          const freshNonce = await wallet.getNonce("latest");
          overrides.nonce = freshNonce;
          console.log(`[blacklist] Retry ${attempt} with nonce ${freshNonce}`);
        }

        const tx = await contract.batchSetBlacklist(batch, true, overrides);
        txHash = tx.hash as string;
        sent = true;
        console.log(`[blacklist] tx submitted: ${txHash}`);

        const receipt = await waitForReceipt(txHash, TX_TIMEOUT_MS);
        if (receipt.status === 0) throw new Error("transaction reverted");

        console.log(`[blacklist] ✓ confirmed: ${txHash}`);
        succeededAddresses.push(...batch);
        break; // success — exit retry loop
      } catch (err: any) {
        const msg = err?.shortMessage ?? err?.message ?? "error";
        const isNonceError = msg.includes("nonce") || msg.includes("replacement") || msg.includes("already known");
        const isRpcError = msg.includes("no backend") || msg.includes("coalesce") || msg.includes("fetch failed");

        if (sent && isRpcError) {
          // Tx was submitted — RPC just went down while polling receipt
          console.warn(`[blacklist] ⚠ Batch ${i + 1}: tx ${txHash} submitted but receipt polling failed (RPC flap). Counting as done.`);
          succeededAddresses.push(...batch);
          break;
        }

        if (!sent && isNonceError && attempt < MAX_NONCE_RETRIES) {
          console.warn(`[blacklist] ⚠ Batch ${i + 1} nonce error (attempt ${attempt}): ${msg} — retrying with fresh nonce`);
          continue;
        }

        // Non-nonce send failure or exhausted retries — skip this batch, do not fall back individually
        console.error(`[blacklist] ✗ Batch ${i + 1} failed after ${attempt} attempt(s): ${msg}`);
        break;
      }
    }

    // Save progress after every batch so we can resume if interrupted
    fs.writeFileSync(
      progressPath,
      JSON.stringify([...alreadyDone, ...succeededAddresses], null, 0)
    );
  }

  // ── 3. Insert into Supabase blacklisted_addresses ─────────────────────────
  console.log("\n[blacklist] Syncing to Supabase blacklisted_addresses…");
  const now = new Date().toISOString();
  let dbInserted = 0;

  for (const upsertBatch of chunk(succeededAddresses, 500)) {
    const dbRows = upsertBatch.map((addr) => ({
      address: addr,
      reason: "bot-farm-batch",
      blacklisted_at: now,
    }));
    const { error: dbErr } = await supabase
      .from("blacklisted_addresses")
      .upsert(dbRows, { onConflict: "address", ignoreDuplicates: true });
    if (dbErr) {
      console.error("[blacklist] Supabase upsert error:", dbErr.message);
    } else {
      dbInserted += upsertBatch.length;
    }
  }
  console.log(`[blacklist] ✓ ${dbInserted}/${succeededAddresses.length} rows upserted in Supabase`);

  const totalDone = succeededAddresses.length;
  console.log(`\n[blacklist] Complete. Total blacklisted on-chain: ${totalDone}/${remaining.length}`);

  // ── 4. Write output report ────────────────────────────────────────────────
  const succeededSet = new Set(succeededAddresses.map((a) => a.toLowerCase()));
  const output = {
    generated_at: new Date().toISOString(),
    dry_run: false,
    blacklisted_count: totalDone,
    skipped_count: skipped,
    blacklisted: filtered.map((e) => ({
      ...e,
      blacklisted: succeededSet.has(e.user_address.toLowerCase()),
      skipped: false,
    })),
    skipped: skippedEntries.map((e) => ({ ...e, blacklisted: false, skipped: true })),
  };
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`[blacklist] Report written to ${outputPath}`);
}

main().catch((e) => {
  console.error("[blacklist] Fatal:", e);
  process.exit(1);
});
