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

// Jobs claimed per wallet per round. Total claimed = BATCH_SIZE × wallet count.
const BATCH_SIZE = 400;
const LOCK_NAME = "default";
const LOCK_LEASE_SECONDS = 300; // 5 min; renewed each round
const MAX_JOB_ATTEMPTS = 6;
const TX_TIMEOUT_MS = 60_000;
const BATCH_RETRY_ATTEMPTS = 3;
const BATCH_RETRY_DELAY_MS = 5_000;

// Round-robin across these RPCs so wallets don't all hammer the same node.
const RPC_URLS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
];

const BATCH_MINT_ABI = [
  "function batchMint(address[] calldata accounts, uint256[] calldata amounts) external",
  "function claimV2TokensFor(address user) external",
  "error Blacklisted()",
  "error Unauthorized()",
  "error NullAddress()",
];

// ── Wallets ───────────────────────────────────────────────────────────────────
// Reads MINTER_PK_1 … MINTER_PK_4 (or falls back to RETRY_PK / PRIVATE_KEY).
// Each extra registered minter wallet = one more parallel batchMint tx per round.
function makeWallets() {
  const pks = [
    process.env.MINTER_PK_1 ?? process.env.RETRY_PK ?? process.env.PRIVATE_KEY,
    process.env.MINTER_PK_2,
    process.env.MINTER_PK_3,
    process.env.MINTER_PK_4,
  ].filter((pk): pk is string => !!pk);

  if (pks.length === 0) throw new Error("No minter PKs configured");

  const wallets = pks.map((pk, i) => {
    const provider = new ethers.JsonRpcProvider(RPC_URLS[i % RPC_URLS.length]);
    const wallet = new ethers.Wallet(pk, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, BATCH_MINT_ABI, wallet);
    return { wallet, contract };
  });

  console.log(
    `[mintWorker] ${wallets.length} wallet(s): ${wallets.map((w) => w.wallet.address).join(", ")}`
  );
  return wallets;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isBlacklistedError(err: any): boolean {
  if (err?.errorName === "Blacklisted") return true;
  const msg: string = (err?.shortMessage ?? err?.message ?? "").toLowerCase();
  return msg.includes("blacklisted") || msg.includes("0x" + "b4c62e72");
}

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

async function permanentlyFail(jobId: string, reason: string) {
  await supabase.rpc("fail_minipoint_mint_job", { p_job_id: jobId, p_error: reason });
}

async function renewLock(owner: string) {
  await supabase.rpc("acquire_minipoint_mint_queue_lock", {
    p_lock_name: LOCK_NAME,
    p_owner: owner,
    p_lease_seconds: LOCK_LEASE_SECONDS,
  });
}

async function resetStalledJobs() {
  const { data } = await supabase
    .from("minipoint_mint_jobs")
    .update({ status: "pending" })
    .eq("status", "processing")
    .select("id");
  const count = data?.length ?? 0;
  if (count > 0) console.log(`[mintWorker] Unstuck ${count} stalled jobs`);
}

// Single bulk fetch + mark-processing instead of N sequential RPC calls.
async function claimBatch(count: number): Promise<any[]> {
  const now = new Date().toISOString();
  const { data: jobs, error } = await supabase
    .from("minipoint_mint_jobs")
    .select("*")
    .eq("status", "pending")
    .or(`run_after.is.null,run_after.lte.${now}`)
    .order("created_at", { ascending: true })
    .limit(count);

  if (error) throw error;
  if (!jobs || jobs.length === 0) return [];

  await supabase
    .from("minipoint_mint_jobs")
    .update({ status: "processing", updated_at: now })
    .in("id", jobs.map((j) => j.id));

  return jobs;
}

// ── Bulk DB side-effects + complete ──────────────────────────────────────────
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
      .from("users").update({ profile_milestone_50_claimed: true }).in("user_address", m50);
    if (error) console.error("[mintWorker] bulk milestone_50:", error.message);
  }

  if (m100.length > 0) {
    const { error } = await supabase
      .from("users").update({ profile_milestone_100_claimed: true }).in("user_address", m100);
    if (error) console.error("[mintWorker] bulk milestone_100:", error.message);
  }

  const { error: completeErr } = await supabase
    .from("minipoint_mint_jobs")
    .update({ status: "completed", tx_hash: txHash, updated_at: new Date().toISOString() })
    .in("id", jobs.map((j) => j.id));
  if (completeErr) console.error("[mintWorker] bulk complete:", completeErr.message);
}

// ── Mint helpers ──────────────────────────────────────────────────────────────
async function processMintBatch(
  jobs: any[],
  contract: ethers.Contract,
  label: string
): Promise<string> {
  const accounts = jobs.map((j) => j.user_address);
  const amounts = jobs.map((j) => ethers.parseUnits(String(j.points), 18));

  let lastErr: any;
  for (let attempt = 1; attempt <= BATCH_RETRY_ATTEMPTS; attempt++) {
    try {
      console.log(`[mintWorker] ${label} batchMint ${jobs.length} jobs… (attempt ${attempt})`);
      const tx = await contract.batchMint(accounts, amounts);
      console.log(`[mintWorker] ${label} tx submitted: ${tx.hash}`);
      const receipt = await tx.wait(1, TX_TIMEOUT_MS);
      const txHash: string = receipt.hash ?? tx.hash;
      console.log(`[mintWorker] ${label} ✓ confirmed: ${txHash}`);
      return txHash;
    } catch (err: any) {
      lastErr = err;
      if (isTransientError(err) && attempt < BATCH_RETRY_ATTEMPTS) {
        console.warn(`[mintWorker] ${label} transient error attempt ${attempt}, retrying: ${err?.shortMessage ?? err?.message}`);
        await new Promise((r) => setTimeout(r, BATCH_RETRY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function processMintJobsIndividually(
  jobs: any[],
  contract: ethers.Contract,
  label: string
): Promise<{ succeeded: any[]; failed: { job: any; msg: string; err: any }[] }> {
  const succeeded: any[] = [];
  const failed: { job: any; msg: string; err: any }[] = [];

  for (const job of jobs) {
    try {
      const tx = await contract.batchMint(
        [job.user_address],
        [ethers.parseUnits(String(job.points), 18)]
      );
      const receipt = await tx.wait(1, TX_TIMEOUT_MS);
      succeeded.push({ ...job, txHash: receipt.hash ?? tx.hash });
    } catch (err: any) {
      failed.push({ job, msg: err?.shortMessage ?? err?.message ?? "error", err });
    }
  }

  if (succeeded.length > 0) console.log(`[mintWorker] ${label} fallback: ${succeeded.length} ok, ${failed.length} failed`);
  return { succeeded, failed };
}

async function handleFailedJobs(failed: { job: any; msg: string }[]) {
  for (const { job, msg } of failed) {
    console.error(`[mintWorker] ✗ Job ${job.id} (${job.user_address}): ${msg}`);
    if (isBlacklistedError({ message: msg })) {
      await permanentlyFail(job.id, "blacklisted");
    } else if ((job.attempts ?? 0) >= MAX_JOB_ATTEMPTS) {
      await permanentlyFail(job.id, msg);
    } else {
      const delay = Math.min(30, 2 ** Math.max(1, job.attempts ?? 1));
      await supabase.rpc("retry_minipoint_mint_job", {
        p_job_id: job.id, p_error: msg, p_delay_seconds: delay,
      });
    }
  }
}

// ── Lock state (exported for graceful shutdown) ───────────────────────────────
let currentLockOwner: string | null = null;

export async function releaseCurrentLock() {
  if (!currentLockOwner) return;
  try {
    await supabase.rpc("release_minipoint_mint_queue_lock", {
      p_lock_name: LOCK_NAME,
      p_owner: currentLockOwner,
    });
    console.log("[mintWorker] Lock released on shutdown");
  } catch (e) {
    // best-effort
  }
  currentLockOwner = null;
}

// On startup, any held lock belongs to a dead process — clear it directly.
async function clearStaleLockOnStartup() {
  try {
    await supabase
      .from("minipoint_queue_locks")
      .update({ locked: false, owner: null, expires_at: null })
      .eq("lock_name", LOCK_NAME);
    console.log("[mintWorker] Cleared stale lock on startup");
  } catch {
    // Table name may differ — silently ignore, lock will expire on its own
  }
}

// ── Main drain run ────────────────────────────────────────────────────────────
let isRunning = false;

export async function runDrain() {
  if (isRunning) {
    console.log("[mintWorker] Already running, skipping");
    return;
  }
  isRunning = true;

  try {
    await resetStalledJobs();

    const wallets = makeWallets();
    const owner = randomUUID();

    const { data: acquired } = await supabase.rpc("acquire_minipoint_mint_queue_lock", {
      p_lock_name: LOCK_NAME,
      p_owner: owner,
      p_lease_seconds: LOCK_LEASE_SECONDS,
    });

    if (!acquired) {
      console.log("[mintWorker] Lock busy, skipping this run");
      return;
    }

    currentLockOwner = owner;

    let totalMinted = 0;
    let totalMigrated = 0;
    let round = 0;

    try {
      while (true) {
        await renewLock(owner);

        // Claim enough jobs for all wallets in one shot
        const allJobs = await claimBatch(BATCH_SIZE * wallets.length);
        if (allJobs.length === 0) {
          console.log("[mintWorker] Queue empty, done.");
          break;
        }

        const mintJobs = allJobs.filter((j) => j.payload?.kind !== "v2_migration");
        const migrationJobs = allJobs.filter((j) => j.payload?.kind === "v2_migration");

        round++;
        console.log(`[mintWorker] Round ${round}: ${mintJobs.length} mint across ${wallets.length} wallet(s), ${migrationJobs.length} migration`);

        // ── Split mint jobs across wallets and fire in parallel ─────────────
        if (mintJobs.length > 0) {
          const chunkSize = Math.ceil(mintJobs.length / wallets.length);
          const chunks = wallets
            .map((w, i) => ({
              ...w,
              label: `W${i + 1}`,
              jobs: mintJobs.slice(i * chunkSize, (i + 1) * chunkSize),
            }))
            .filter((c) => c.jobs.length > 0);

          const results = await Promise.allSettled(
            chunks.map(async ({ contract, jobs, label }) => {
              try {
                const txHash = await processMintBatch(jobs, contract, label);
                await applyBatchPayloads(jobs, txHash);
                return { minted: jobs.length };
              } catch (batchErr: any) {
                console.warn(`[mintWorker] ${label} batch failed, falling back: ${batchErr?.shortMessage ?? batchErr?.message}`);
                const { succeeded, failed } = await processMintJobsIndividually(jobs, contract, label);

                const byHash = new Map<string, any[]>();
                for (const j of succeeded) {
                  const arr = byHash.get(j.txHash) ?? [];
                  arr.push(j);
                  byHash.set(j.txHash, arr);
                }
                for (const [hash, group] of byHash) {
                  await applyBatchPayloads(group, hash);
                }
                await handleFailedJobs(failed);
                return { minted: succeeded.length };
              }
            })
          );

          for (const result of results) {
            if (result.status === "fulfilled") totalMinted += result.value.minted;
          }
        }

        // ── Migration jobs — serial, each reads V1 balance on-chain ─────────
        for (const job of migrationJobs) {
          try {
            const tx = await wallets[0].contract.claimV2TokensFor(job.user_address);
            const receipt = await tx.wait(1, TX_TIMEOUT_MS);
            const txHash: string = receipt.hash ?? tx.hash;
            console.log(`[mintWorker] ✓ Migrated ${job.user_address} tx: ${txHash}`);
            await supabase.rpc("complete_minipoint_mint_job", { p_job_id: job.id, p_tx_hash: txHash });
            totalMigrated++;
          } catch (err: any) {
            const msg = err?.shortMessage ?? err?.message ?? "error";
            console.error(`[mintWorker] ✗ Migration ${job.id}: ${msg}`);
            if (isBlacklistedError(err)) {
              await permanentlyFail(job.id, "blacklisted");
            } else if ((job.attempts ?? 0) >= MAX_JOB_ATTEMPTS) {
              await permanentlyFail(job.id, msg);
            } else {
              const delay = Math.min(30, 2 ** Math.max(1, job.attempts ?? 1));
              await supabase.rpc("retry_minipoint_mint_job", { p_job_id: job.id, p_error: msg, p_delay_seconds: delay });
            }
          }
        }

        console.log(`[mintWorker] Round ${round} done — ${totalMinted} minted, ${totalMigrated} migrated so far`);
      }
    } finally {
      await supabase.rpc("release_minipoint_mint_queue_lock", { p_lock_name: LOCK_NAME, p_owner: owner });
      currentLockOwner = null;
    }

    console.log(`[mintWorker] Complete — ${totalMinted} minted, ${totalMigrated} migrated`);
  } catch (err: any) {
    console.error("[mintWorker] Fatal error:", err?.message);
  } finally {
    isRunning = false;
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
export async function startMintWorker() {
  console.log("[mintWorker] Starting — runs every minute");
  await clearStaleLockOnStartup();
  runDrain().catch(console.error);
  cron.schedule("* * * * *", () => {
    runDrain().catch(console.error);
  });
}
