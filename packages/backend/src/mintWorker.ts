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
const MAX_JOB_ATTEMPTS = 6;
const BATCH_SIZE = 400;
const LOCK_LEASE_SECONDS = 1800; // 30 min; isRunning flag prevents same-process overlap

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

// Bulk DB side-effects + bulk complete for an entire batch
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

  const m50 = jobs
    .filter((j) => j.payload?.kind === "profile_milestone" && j.payload.milestone === 50)
    .map((j) => j.payload.userAddress.toLowerCase());
  const m100 = jobs
    .filter((j) => j.payload?.kind === "profile_milestone" && j.payload.milestone !== 50)
    .map((j) => j.payload.userAddress.toLowerCase());

  if (dailyRows.length > 0) {
    const { error } = await supabase
      .from("daily_engagements")
      .upsert(dailyRows, { onConflict: "user_address,quest_id,claimed_at", ignoreDuplicates: true });
    if (error && error.code !== "23505") console.error("[mintWorker] bulk daily_engagements:", error.message);
  }

  if (partnerRows.length > 0) {
    const { error } = await supabase
      .from("partner_engagements")
      .upsert(partnerRows, { onConflict: "user_address,partner_quest_id,claimed_at", ignoreDuplicates: true });
    if (error && error.code !== "23505") console.error("[mintWorker] bulk partner_engagements:", error.message);
  }

  if (m50.length > 0) {
    const { error } = await supabase
      .from("users")
      .update({ profile_milestone_50_claimed: true })
      .in("user_address", m50);
    if (error) console.error("[mintWorker] bulk milestone_50:", error.message);
  }

  if (m100.length > 0) {
    const { error } = await supabase
      .from("users")
      .update({ profile_milestone_100_claimed: true })
      .in("user_address", m100);
    if (error) console.error("[mintWorker] bulk milestone_100:", error.message);
  }

  const ids = jobs.map((j) => j.id);
  const { error: completeErr } = await supabase
    .from("minipoint_mint_jobs")
    .update({ status: "completed", tx_hash: txHash, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (completeErr) console.error("[mintWorker] bulk complete:", completeErr.message);
}

const TX_TIMEOUT_MS = 60_000; // 60 s — abort tx.wait() if no confirmation
const BATCH_RETRY_ATTEMPTS = 3;
const BATCH_RETRY_DELAY_MS = 5_000;

// Returns true for transient RPC/infra failures that warrant a retry.
// Returns false for contract reverts (blacklisted address, etc.) that warrant fallback.
function isTransientError(err: any): boolean {
  const msg: string = (err?.shortMessage ?? err?.message ?? "").toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("service unavailable") ||
    msg.includes("could not coalesce") ||
    msg.includes("timeout") ||
    msg.includes("network error") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout")
  );
}

// ── Batch mint a chunk of regular mint jobs ───────────────────────────────────
async function processMintBatch(
  jobs: any[],
  contract: ethers.Contract
): Promise<{ txHash: string; succeeded: any[]; failed: any[] }> {
  const accounts = jobs.map((j) => j.user_address);
  const amounts = jobs.map((j) => ethers.parseUnits(String(j.points), 18));

  let lastErr: any;
  for (let attempt = 1; attempt <= BATCH_RETRY_ATTEMPTS; attempt++) {
    try {
      console.log(`[mintWorker] batchMint sending ${jobs.length} jobs… (attempt ${attempt})`);
      const tx = await contract.batchMint(accounts, amounts);
      console.log(`[mintWorker] batchMint tx submitted: ${tx.hash}`);
      const receipt = await tx.wait(1, TX_TIMEOUT_MS);
      const txHash: string = receipt.hash ?? tx.hash;
      return { txHash, succeeded: jobs, failed: [] };
    } catch (err: any) {
      lastErr = err;
      if (isTransientError(err) && attempt < BATCH_RETRY_ATTEMPTS) {
        console.warn(`[mintWorker] Transient RPC error on attempt ${attempt}, retrying in ${BATCH_RETRY_DELAY_MS / 1000}s: ${err?.shortMessage ?? err?.message}`);
        await new Promise((r) => setTimeout(r, BATCH_RETRY_DELAY_MS));
      } else {
        // Contract revert or out of retries — propagate so caller decides fallback
        throw err;
      }
    }
  }
  throw lastErr;
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

    const { data: acquired } = await supabase.rpc(
      "acquire_minipoint_mint_queue_lock",
      { p_lock_name: LOCK_NAME, p_owner: owner, p_lease_seconds: LOCK_LEASE_SECONDS }
    );

    if (!acquired) {
      console.log("[mintWorker] Lock busy, skipping this run");
      return;
    }

    let totalMinted = 0;
    let totalMigrated = 0;
    let round = 0;

    try {
      // ── Loop until the queue is empty ──────────────────────────────────────
      while (true) {
        const mintJobs: any[] = [];
        const migrationJobs: any[] = [];

        for (let i = 0; i < BATCH_SIZE; i++) {
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

        if (mintJobs.length === 0 && migrationJobs.length === 0) {
          console.log("[mintWorker] Queue empty, done.");
          break;
        }

        round++;
        console.log(`[mintWorker] Round ${round}: ${mintJobs.length} mint, ${migrationJobs.length} migration`);

        // ── Mint jobs — one batchMint tx for the whole chunk ────────────────
        if (mintJobs.length > 0) {
          try {
            const { txHash } = await processMintBatch(mintJobs, contract);
            console.log(`[mintWorker] ✓ batchMint ${mintJobs.length} — tx: ${txHash}`);
            await applyBatchPayloads(mintJobs, txHash);
            totalMinted += mintJobs.length;
          } catch (batchErr: any) {
            console.warn(`[mintWorker] batchMint failed, falling back: ${batchErr?.shortMessage ?? batchErr?.message}`);

            const { succeeded, failed } = await processMintJobsIndividually(mintJobs, contract);

            // Group by txHash so each group gets one bulk apply call
            const byHash = new Map<string, any[]>();
            for (const j of succeeded) {
              const arr = byHash.get(j.txHash) ?? [];
              arr.push(j);
              byHash.set(j.txHash, arr);
            }
            for (const [hash, group] of byHash) {
              await applyBatchPayloads(group, hash);
            }
            totalMinted += succeeded.length;

            for (const { job, msg } of failed) {
              console.error(`[mintWorker] ✗ Job ${job.id} failed: ${msg}`);
              if (isBlacklistedError({ message: msg })) {
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

        // ── Migration jobs — each reads V1 balance on-chain, must be serial ─
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
            totalMigrated++;
          } catch (err: any) {
            const msg = err?.shortMessage ?? err?.message ?? "error";
            console.error(`[mintWorker] ✗ Migration job ${job.id} failed: ${msg}`);
            if (isBlacklistedError(err)) {
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

        console.log(`[mintWorker] Round ${round} done — ${totalMinted} minted, ${totalMigrated} migrated so far`);
      }
    } finally {
      await supabase.rpc("release_minipoint_mint_queue_lock", {
        p_lock_name: LOCK_NAME,
        p_owner: owner,
      });
    }

    console.log(`[mintWorker] Complete — ${totalMinted} minted, ${totalMigrated} migrated`);
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
