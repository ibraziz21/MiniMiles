/**
 * exactOneBurnWallets.ts
 *
 * Finds wallets that burned exactly 1 AkibaMile in the last 3 days,
 * saves them to burn-one-wallets.json, then batch-blacklists them
 * on-chain and in Supabase.
 *
 * .env required:
 *   MINIPOINTS_V2_ADDRESS=  (optional, falls back to known address)
 *   DRAIN_PK=               (private key with onlyAllowed on V2)
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_KEY=
 *
 * Run:
 *   cd packages/backend
 *   npx ts-node src/exactOneBurnWallets.ts
 *
 * Dry run (scan + save JSON, no on-chain tx):
 *   DRY_RUN=true npx ts-node src/exactOneBurnWallets.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import * as fs from "fs";
import * as path from "path";
import { ethers } from "ethers";
import { supabase } from "./supabaseClient";

const RPC = process.env.CELO_RPC_URL ?? "https://forno.celo.org";
const CONTRACT = process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";
const CELO_BLOCK_TIME_SECS = 5;
const DECIMALS = 18;
const ONE_AKIBAMILE = 10n ** BigInt(DECIMALS);
const PROSPERITY_PASS_BURN = 100n * ONE_AKIBAMILE;
const BATCH_SIZE = 500;
const TX_TIMEOUT_MS = 90_000;
const DRY_RUN = process.env.DRY_RUN === "true";
const FROM_BLOCK_OVERRIDE = process.env.FROM_BLOCK ? Number(process.env.FROM_BLOCK) : null;
const TO_BLOCK_OVERRIDE = process.env.TO_BLOCK ? Number(process.env.TO_BLOCK) : null;

const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const ZERO_ADDRESS_TOPIC = ethers.zeroPadValue(ethers.ZeroAddress, 32);

const BATCH_BLACKLIST_ABI = [
  "function batchSetBlacklist(address[] calldata accounts, bool blacklisted) external",
];

type BurnRun = {
  generated_at: string;
  from_block: number;
  to_block: number;
  count: number;
  wallets: string[];
};

type BurnWalletArchive = BurnRun & {
  runs: BurnRun[];
  all_wallet_count: number;
  all_wallets: string[];
};

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

function readExistingArchive(filePath: string): BurnWalletArchive | null {
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!raw || typeof raw !== "object") return null;

    const hasRuns = Array.isArray(raw.runs);
    const runs: BurnRun[] = hasRuns
      ? raw.runs
      : [{
          generated_at: raw.generated_at,
          from_block: raw.from_block,
          to_block: raw.to_block,
          count: raw.count,
          wallets: Array.isArray(raw.wallets) ? raw.wallets : [],
        }];

    const allWallets = Array.isArray(raw.all_wallets)
      ? raw.all_wallets
      : [...new Set(runs.flatMap((run) => run.wallets))];

    return {
      generated_at: raw.generated_at,
      from_block: raw.from_block,
      to_block: raw.to_block,
      count: raw.count,
      wallets: Array.isArray(raw.wallets) ? raw.wallets : [],
      runs,
      all_wallet_count: typeof raw.all_wallet_count === "number" ? raw.all_wallet_count : allWallets.length,
      all_wallets: allWallets,
    };
  } catch {
    return null;
  }
}

async function waitForReceipt(provider: ethers.JsonRpcProvider, txHash: string): Promise<void> {
  const deadline = Date.now() + TX_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const receipt = await provider.getTransactionReceipt(txHash).catch(() => null);
    if (receipt?.status != null) {
      if (receipt.status === 0) throw new Error(`tx reverted: ${txHash}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Receipt timeout for ${txHash}`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);

  // ── 1. Scan burns from the last 3 days ───────────────────────────────────
  const latest = await provider.getBlockNumber();
  const blocksIn3Days = Math.round((3 * 24 * 60 * 60) / CELO_BLOCK_TIME_SECS);
  const toBlock = TO_BLOCK_OVERRIDE ?? latest;
  const fromBlock = FROM_BLOCK_OVERRIDE ?? Math.max(0, toBlock - blocksIn3Days);

  if (!Number.isInteger(fromBlock) || fromBlock < 0) {
    throw new Error(`Invalid FROM_BLOCK: ${process.env.FROM_BLOCK}`);
  }
  if (!Number.isInteger(toBlock) || toBlock < 0) {
    throw new Error(`Invalid TO_BLOCK: ${process.env.TO_BLOCK}`);
  }
  if (fromBlock > toBlock) {
    throw new Error(`FROM_BLOCK (${fromBlock}) cannot be greater than TO_BLOCK (${toBlock})`);
  }

  console.log(`[burn-scan] Scanning blocks ${fromBlock} → ${toBlock}`);

  const logs = await provider.getLogs({
    address: CONTRACT,
    topics: [TRANSFER_TOPIC, null, ZERO_ADDRESS_TOPIC],
    fromBlock,
    toBlock,
  });

  console.log(`[burn-scan] Found ${logs.length} burn event(s)`);

  const burnTotals = new Map<string, bigint>();
  for (const log of logs) {
    const from = ethers.getAddress("0x" + log.topics[1].slice(26)).toLowerCase();
    const value = BigInt(log.data);
    burnTotals.set(from, (burnTotals.get(from) ?? 0n) + value);
  }

  const wallets = [...burnTotals.entries()]
    // This script only targets the exact 1-Mile blacklist probe.
    // The Prosperity Pass flow burns 100 Miles and must never be blacklisted here.
    .filter(([, total]) => total === ONE_AKIBAMILE)
    .map(([addr]) => addr);

  console.log(`[burn-scan] Wallets that burned exactly 1 AkibaMile: ${wallets.length}`);
  const prosperityPassBurns = [...burnTotals.values()].filter((total) => total === PROSPERITY_PASS_BURN).length;
  if (prosperityPassBurns > 0) {
    console.log(`[burn-scan] Ignored ${prosperityPassBurns} Prosperity Pass burn(s) of 100 AkibaMiles`);
  }

  // ── 2. Save JSON ─────────────────────────────────────────────────────────
  const outPath = path.resolve(__dirname, "burn-one-wallets.json");
  const currentRun: BurnRun = {
    generated_at: new Date().toISOString(),
    from_block: fromBlock,
    to_block: toBlock,
    count: wallets.length,
    wallets,
  };
  const existingArchive = readExistingArchive(outPath);
  const previousRuns = existingArchive?.runs ?? [];
  const runs = [...previousRuns, currentRun];
  const allWallets = [...new Set(runs.flatMap((run) => run.wallets))];
  const output: BurnWalletArchive = {
    ...currentRun,
    runs,
    all_wallet_count: allWallets.length,
    all_wallets: allWallets,
  };

  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(
    `[burn-scan] Saved to burn-one-wallets.json (${runs.length} run(s), ${allWallets.length} unique wallet(s) total)`,
  );

  if (wallets.length === 0) {
    console.log("[burn-scan] Nothing to blacklist.");
    return;
  }

  if (DRY_RUN) {
    console.log("[burn-scan] DRY_RUN=true — skipping on-chain blacklist.");
    return;
  }

  // ── 3. On-chain batchSetBlacklist ─────────────────────────────────────────
  const pk = process.env.DRAIN_PK;
  if (!pk) throw new Error("DRAIN_PK not set");

  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(CONTRACT, BATCH_BLACKLIST_ABI, wallet);
  console.log(`[blacklist] Wallet: ${wallet.address}`);

  const batches = chunk(wallets, BATCH_SIZE);
  const succeeded: string[] = [];

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`[blacklist] Batch ${i + 1}/${batches.length}: ${batch.length} addresses`);
    try {
      const tx = await contract.batchSetBlacklist(batch, true);
      console.log(`[blacklist] tx submitted: ${tx.hash}`);
      await waitForReceipt(provider, tx.hash);
      console.log(`[blacklist] ✓ confirmed: ${tx.hash}`);
      succeeded.push(...batch);
    } catch (err: any) {
      console.error(`[blacklist] ✗ Batch ${i + 1} failed: ${err?.shortMessage ?? err?.message}`);
    }
  }

  // ── 4. Upsert into Supabase ───────────────────────────────────────────────
  console.log(`\n[blacklist] Syncing ${succeeded.length} addresses to Supabase…`);
  const now = new Date().toISOString();

  for (const batch of chunk(succeeded, 500)) {
    const rows = batch.map((addr) => ({ address: addr, reason: "burn-one-akibamile", blacklisted_at: now }));
    const { error } = await supabase
      .from("blacklisted_addresses")
      .upsert(rows, { onConflict: "address", ignoreDuplicates: true });
    if (error) console.error("[blacklist] Supabase error:", error.message);
  }

  console.log(`[blacklist] Done. ${succeeded.length}/${wallets.length} blacklisted.`);
}

main().catch((e) => {
  console.error("[burn-scan] Fatal:", e);
  process.exit(1);
});
