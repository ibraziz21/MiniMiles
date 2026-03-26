// src/mintWorker.ts
import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { randomUUID } from "crypto";
import { ethers } from "ethers";
import { supabase } from "./supabaseClient";

// ── Config ───────────────────────────────────────────────────────────────────
const CONTRACT_ADDRESS =
  process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";

const LOCK_NAME = "default";
const MAX_JOBS_PER_RUN = 1000; // drained in batches of BATCH_SIZE per tx
const MAX_JOB_ATTEMPTS = 6;
const BATCH_SIZE = 200;

const BATCH_MINT_ABI = [
  "function batchMint(address[] calldata accounts, uint256[] calldata amounts) external",
  "function claimV2TokensFor(address user) external",
  "error Blacklisted()",
  "error Unauthorized()",
  "error NullAddress()",
];

// ── Wallet ────────────────────────────────────────────────────────────────────
function makeWallet() {
  const pk = process.env.RETRY_PK ?? process.env.PRIVATE_KEY;
  if (!pk) throw new Error("No RETRY_PK or PRIVATE_KEY set");
  const provider = new ethers.JsonRpcProvider("https://forno.celo.org");
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, BATCH_MINT_ABI, wallet);
  console.log(`[mintWorker] Using wallet: ${wallet.address}`);
  return { wallet, contract };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isDupe(e: any) { return e?.code === "23505"; }

function isBlacklistedError(err: any): boolean {
  // ethers v6 decodes custom errors into errorName when the ABI includes them
  if (err?.errorName === "Blacklisted") return true;
  const msg: string = (err?.shortMessage ?? err?.message ?? "").toLowerCase();
  return msg.includes("blacklisted") || msg.includes("0x" + "b4c62e72"); // Blacklisted() selector
}

async function permanentlyFail(jobId: string, reason: string) {
  await supabase.rpc("fail_minipoint_mint_job", {
    p_job_id: jobId,
    p_error: reason,
  });
}

async function resetStalledJobs() {
  const { data } = await supabase
    .from("minipoint_mint_jobs")
    .update({ status: "pending" })
    .eq("status", "processing")
    .select("id");

  const count = data?.length ?? 0;
  if (count > 0) {
    console.log(`[mintWorker] Unstuck ${count} processing jobs back to pending`);
  }
}

async function applyPayload(payload: any) {
  if (payload.kind === "daily_engagement") {
    const { error } = await supabase.from("daily_engagements").insert({
      user_address: payload.userAddress,
      quest_id: payload.questId,
      claimed_at: payload.claimedAt,
      points_awarded: payload.pointsAwarded,
    });
    if (error && !isDupe(error)) throw error;
    return;
  }

  if (payload.kind === "profile_milestone") {
    const field = payload.milestone === 50
      ? "profile_milestone_50_claimed"
      : "profile_milestone_100_claimed";
    const { error } = await supabase
      .from("users")
      .update({ [field]: true })
      .eq("user_address", payload.userAddress.toLowerCase());
    if (error) throw error;
    return;
  }

  if (payload.kind === "v2_migration") {
    return; // contract handles everything atomically
  }

  if (payload.kind === "new_user_signup" || payload.kind === "referral_bonus") {
    return; // DB side effects applied by API route before enqueuing
  }

  // partner_engagement
  const { error } = await supabase.from("partner_engagements").insert({
    user_address: payload.userAddress,
    partner_quest_id: payload.questId,
    claimed_at: payload.claimedAt,
    points_awarded: payload.pointsAwarded,
  });
  if (error && !isDupe(error)) throw error;
}

const TX_TIMEOUT_MS = 60_000; // 60 s — abort tx.wait() if no confirmation

// ── Batch mint a chunk of regular mint jobs ───────────────────────────────────
async function processMintBatch(
  jobs: any[],
  contract: ethers.Contract
): Promise<{ txHash: string; succeeded: any[]; failed: any[] }> {
  const accounts = jobs.map((j) => j.user_address);
  const amounts = jobs.map((j) => ethers.parseUnits(String(j.points), 18));

  console.log(`[mintWorker] batchMint sending ${jobs.length} jobs…`);
  const tx = await contract.batchMint(accounts, amounts);
  console.log(`[mintWorker] batchMint tx submitted: ${tx.hash}`);
  const receipt = await tx.wait(1, TX_TIMEOUT_MS);
  const txHash: string = receipt.hash ?? tx.hash;

  return { txHash, succeeded: jobs, failed: [] };
}

// ── Fallback: mint jobs one by one if batch reverts ──────────────────────────
async function processMintJobsIndividually(
  jobs: any[],
  contract: ethers.Contract
): Promise<{ succeeded: any[]; failed: { job: any; msg: string; err: any }[] }> {
  const succeeded: any[] = [];
  const failed: { job: any; msg: string; err: any }[] = [];

  for (const job of jobs) {
    try {
      const amount = ethers.parseUnits(String(job.points), 18);
      const tx = await contract.batchMint([job.user_address], [amount]);
      const receipt = await tx.wait(1, TX_TIMEOUT_MS);
      const txHash: string = receipt.hash ?? tx.hash;
      succeeded.push({ ...job, txHash });
    } catch (err: any) {
      failed.push({ job, msg: err?.shortMessage ?? err?.message ?? "error", err });
    }
  }

  return { succeeded, failed };
}

// ── Main drain run ─────────────────────────────────────────────────────────────
let isRunning = false;

export async function runDrain() {
  if (isRunning) {
    console.log("[mintWorker] Already running, skipping");
    return;
  }
  isRunning = true;

  try {
    await resetStalledJobs();

    const { contract } = makeWallet();
    const owner = randomUUID();
    // Each batch (BATCH_SIZE jobs) = ~60s tx + overhead; lease covers all batches + buffer
    const numBatches = Math.ceil(MAX_JOBS_PER_RUN / BATCH_SIZE);
    const leaseSeconds = numBatches * 90 + 60; // e.g. 2 batches → 240s

    const { data: acquired } = await supabase.rpc(
      "acquire_minipoint_mint_queue_lock",
      { p_lock_name: LOCK_NAME, p_owner: owner, p_lease_seconds: leaseSeconds }
    );

    if (!acquired) {
      console.log("[mintWorker] Lock busy, skipping this run");
      return;
    }

    const mintJobs: any[] = [];
    const migrationJobs: any[] = [];

    try {
      // ── 1. Claim all pending jobs ──────────────────────────────────────────
      for (let i = 0; i < MAX_JOBS_PER_RUN; i++) {
        const { data } = await supabase.rpc("claim_next_minipoint_mint_job", {
          p_lock_name: LOCK_NAME,
          p_owner: owner,
        });

        const job = (Array.isArray(data) ? data[0] : data) as any | null;
        if (!job) break;

        if (job.payload?.kind === "v2_migration") {
          migrationJobs.push(job);
        } else {
          mintJobs.push(job);
        }
      }

      console.log(`[mintWorker] Claimed ${mintJobs.length} mint jobs, ${migrationJobs.length} migration jobs`);

      // ── 2. Process mint jobs in batches ────────────────────────────────────
      let mintProcessed = 0;

      for (let offset = 0; offset < mintJobs.length; offset += BATCH_SIZE) {
        const chunk = mintJobs.slice(offset, offset + BATCH_SIZE);

        try {
          const { txHash, succeeded } = await processMintBatch(chunk, contract);
          console.log(`[mintWorker] ✓ batchMint ${succeeded.length} jobs — tx: ${txHash}`);

          for (const job of succeeded) {
            try {
              await applyPayload(job.payload);
              await supabase.rpc("complete_minipoint_mint_job", {
                p_job_id: job.id,
                p_tx_hash: txHash,
              });
              mintProcessed++;
            } catch (applyErr: any) {
              console.error(`[mintWorker] applyPayload failed for job ${job.id}:`, applyErr?.message);
            }
          }
        } catch (batchErr: any) {
          // Batch reverted (e.g. blacklisted address in chunk) — fall back to individual
          console.warn(`[mintWorker] batchMint chunk failed, falling back to individual: ${batchErr?.shortMessage ?? batchErr?.message}`);

          const { succeeded, failed } = await processMintJobsIndividually(chunk, contract);

          for (const job of succeeded) {
            try {
              await applyPayload(job.payload);
              await supabase.rpc("complete_minipoint_mint_job", {
                p_job_id: job.id,
                p_tx_hash: job.txHash,
              });
              mintProcessed++;
            } catch (applyErr: any) {
              console.error(`[mintWorker] applyPayload failed for job ${job.id}:`, applyErr?.message);
            }
          }

          for (const { job, msg } of failed) {
            console.error(`[mintWorker] ✗ Job ${job.id} failed individually: ${msg}`);
            if (isBlacklistedError({ message: msg })) {
              console.warn(`[mintWorker] Permanently failing blacklisted job ${job.id} (${job.user_address})`);
              await permanentlyFail(job.id, "blacklisted");
            } else if ((job.attempts ?? 0) >= MAX_JOB_ATTEMPTS) {
              await permanentlyFail(job.id, msg);
            } else {
              const delay = Math.min(30, 2 ** Math.max(1, job.attempts ?? 1));
              await supabase.rpc("retry_minipoint_mint_job", {
                p_job_id: job.id,
                p_error: msg,
                p_delay_seconds: delay,
              });
            }
          }
        }
      }

      // ── 3. Process migration jobs individually (each reads V1 balance on-chain) ──
      let migrateProcessed = 0;

      for (const job of migrationJobs) {
        try {
          const tx = await contract.claimV2TokensFor(job.user_address);
          const receipt = await tx.wait(1, TX_TIMEOUT_MS);
          const txHash: string = receipt.hash ?? tx.hash;
          console.log(`[mintWorker] ✓ Migrated ${job.user_address} tx: ${txHash}`);

          await supabase.rpc("complete_minipoint_mint_job", {
            p_job_id: job.id,
            p_tx_hash: txHash,
          });
          migrateProcessed++;
        } catch (err: any) {
          const msg = err?.shortMessage ?? err?.message ?? "error";
          console.error(`[mintWorker] ✗ Migration job ${job.id} failed: ${msg}`);

          if (isBlacklistedError(err)) {
            console.warn(`[mintWorker] Permanently failing blacklisted migration ${job.id} (${job.user_address})`);
            await permanentlyFail(job.id, "blacklisted");
          } else if ((job.attempts ?? 0) >= MAX_JOB_ATTEMPTS) {
            await permanentlyFail(job.id, msg);
          } else {
            const delay = Math.min(30, 2 ** Math.max(1, job.attempts ?? 1));
            await supabase.rpc("retry_minipoint_mint_job", {
              p_job_id: job.id,
              p_error: msg,
              p_delay_seconds: delay,
            });
          }
        }
      }

      console.log(`[mintWorker] Run complete — ${mintProcessed} minted, ${migrateProcessed} migrated`);
    } finally {
      await supabase.rpc("release_minipoint_mint_queue_lock", {
        p_lock_name: LOCK_NAME,
        p_owner: owner,
      });
    }
  } catch (err: any) {
    console.error("[mintWorker] Fatal error:", err?.message);
  } finally {
    isRunning = false;
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────────
export function startMintWorker() {
  console.log("[mintWorker] Starting — runs every minute");
  runDrain().catch(console.error);
  cron.schedule("* * * * *", () => {
    runDrain().catch(console.error);
  });
}
