/**
 * drain-pending-jobs.ts
 *
 * One-shot local script to batch-mint all pending minipoint_mint_jobs
 * using a separate wallet, bypassing the queue lock entirely.
 *
 * .env required:
 *   SUPABASE_URL=
 *   SUPABASE_SERVICE_KEY=
 *   DRAIN_PK=           (private key of the wallet to use — must be a registered minter on V2)
 *   MINIPOINTS_V2_ADDRESS= (optional, defaults to known address)
 *
 * Run:
 *   cd packages/hardhat
 *   npx ts-node --require dotenv/config scripts/drain-pending-jobs.ts
 */

import * as dotenv from "dotenv";
dotenv.config({ path: require("path").resolve(__dirname, "../../react-app/.env") });
dotenv.config(); // fallback to local .env if present

import { ethers } from "ethers";
import { supabase } from "./supabaseClient";

// ── Config ────────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS =
  process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";
const BATCH_SIZE = 400;
const TX_TIMEOUT_MS = 90_000;

const BATCH_MINT_ABI = [
  "function batchMint(address[] calldata accounts, uint256[] calldata amounts) external",
];

function makeWallet() {
  const pk = process.env.DRAIN_PK;
  if (!pk) throw new Error("DRAIN_PK not set");
  const provider = new ethers.JsonRpcProvider("https://forno.celo.org");
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, BATCH_MINT_ABI, wallet);
  console.log(`[drain] Wallet: ${wallet.address}`);
  return { wallet, contract };
}

// ── Bulk DB side-effects after successful batch mint ──────────────────────────
function isDupe(e: any) { return e?.code === "23505"; }

async function applyBatchPayloads(jobs: any[], txHash: string) {
  const dailyRows = jobs
    .filter((j) => j.payload?.kind === "daily_engagement")
    .map((j) => ({
      user_address: j.payload.userAddress,
      quest_id: j.payload.questId,
      claimed_at: j.payload.claimedAt,
      points_awarded: j.payload.pointsAwarded,
    }));

  const partnerRows = jobs
    .filter((j) => j.payload?.kind === "partner_engagement")
    .map((j) => ({
      user_address: j.payload.userAddress,
      partner_quest_id: j.payload.questId,
      claimed_at: j.payload.claimedAt,
      points_awarded: j.payload.pointsAwarded,
    }));

  const milestoneJobs = jobs.filter((j) => j.payload?.kind === "profile_milestone");

  // Bulk inserts (ignore duplicates)
  if (dailyRows.length > 0) {
    const { error } = await supabase.from("daily_engagements").upsert(dailyRows, { onConflict: "user_address,quest_id,claimed_at", ignoreDuplicates: true });
    if (error && error.code !== "23505") console.error("[drain] bulk daily_engagements upsert:", error.message);
  }

  if (partnerRows.length > 0) {
    const { error } = await supabase.from("partner_engagements").upsert(partnerRows, { onConflict: "user_address,partner_quest_id", ignoreDuplicates: true });
    if (error && error.code !== "23505") console.error("[drain] bulk partner_engagements upsert:", error.message);
  }

  // Profile milestones must be per-row updates (different field per milestone value)
  for (const job of milestoneJobs) {
    const field = job.payload.milestone === 50 ? "profile_milestone_50_claimed" : "profile_milestone_100_claimed";
    const { error } = await supabase.from("users").update({ [field]: true }).eq("user_address", job.payload.userAddress.toLowerCase());
    if (error) console.error("[drain] profile_milestone update:", error.message);
  }

  // Bulk-complete all jobs in one UPDATE
  const ids = jobs.map((j) => j.id);
  const { error: completeErr } = await supabase
    .from("minipoint_mint_jobs")
    .update({ status: "completed", tx_hash: txHash, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (completeErr) console.error("[drain] bulk complete update:", completeErr.message);
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const { contract } = makeWallet();

  console.log(`[drain] Starting drain…`);

  let totalMinted = 0;
  let page = 0;

  while (true) {
    // Fetch next batch of pending jobs (oldest first)
    const { data: jobs, error } = await supabase
      .from("minipoint_mint_jobs")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(BATCH_SIZE);

    if (error) throw error;
    if (!jobs || jobs.length === 0) {
      console.log("[drain] No more pending jobs.");
      break;
    }

    page++;
    console.log(`\n[drain] Batch ${page}: ${jobs.length} jobs`);

    // Mark all as processing so they don't get picked up by mintWorker mid-flight
    const ids = jobs.map((j: any) => j.id);
    await supabase
      .from("minipoint_mint_jobs")
      .update({ status: "processing" })
      .in("id", ids);

    const accounts = jobs.map((j: any) => j.user_address);
    const amounts = jobs.map((j: any) => ethers.parseUnits(String(j.points), 18));

    let txHash: string;
    try {
      console.log(`[drain] batchMint sending ${jobs.length} jobs…`);
      const tx = await contract.batchMint(accounts, amounts);
      console.log(`[drain] tx submitted: ${tx.hash}`);
      const receipt = await tx.wait(1, TX_TIMEOUT_MS);
      txHash = receipt.hash ?? tx.hash;
      console.log(`[drain] ✓ confirmed: ${txHash}`);
    } catch (batchErr: any) {
      console.warn(`[drain] batchMint failed: ${batchErr?.shortMessage ?? batchErr?.message}`);
      console.log(`[drain] Falling back to individual mints for this batch…`);

      // Fallback: mint one by one
      const fallbackSucceeded: any[] = [];
      for (const job of jobs) {
        try {
          const tx = await contract.batchMint([job.user_address], [ethers.parseUnits(String(job.points), 18)]);
          const receipt = await tx.wait(1, TX_TIMEOUT_MS);
          fallbackSucceeded.push({ ...job, fallbackHash: receipt.hash ?? tx.hash });
          totalMinted++;
        } catch (indErr: any) {
          const msg = indErr?.shortMessage ?? indErr?.message ?? "error";
          console.error(`[drain] ✗ job ${job.id} (${job.user_address}) failed: ${msg}`);
          await supabase.from("minipoint_mint_jobs").update({ status: "pending", last_error: msg }).eq("id", job.id);
        }
      }
      // Bulk-complete succeeded fallback jobs grouped by hash
      const byHash = new Map<string, any[]>();
      for (const j of fallbackSucceeded) {
        const arr = byHash.get(j.fallbackHash) ?? [];
        arr.push(j);
        byHash.set(j.fallbackHash, arr);
      }
      for (const [hash, group] of byHash) {
        await applyBatchPayloads(group, hash);
      }
      continue;
    }

    // Bulk apply DB side-effects and mark all completed in 2-3 queries
    await applyBatchPayloads(jobs, txHash);
    totalMinted += jobs.length;

    console.log(`[drain] Batch ${page} done — ${totalMinted} minted so far`);
  }

  console.log(`\n[drain] Complete. Total minted: ${totalMinted}`);
}

main().catch((e) => {
  console.error("[drain] Fatal:", e);
  process.exit(1);
});
