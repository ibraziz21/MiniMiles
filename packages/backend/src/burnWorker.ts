// src/burnWorker.ts
//
// Drains minipoint_burn_jobs (sql/minipoint_burn_queue.sql in react-app),
// structurally mirroring mintWorker.ts (same lock/claim/retry/fail RPC
// pattern, same receipt-wait helper), but burns go one job at a time — the
// MiniPoints contract has no batchBurn (only single-arg burn(address,
// uint256), confirmed against the ABI), unlike mint's batchMint. Burn
// volume (voucher purchases + one-time passport burns) is far lower than
// mint volume, so this is an acceptable trade.
//
// passport_burn payload jobs are never claimed here — see
// claim_next_minipoint_burn_job's own filter. Those rows are reservation
// bookkeeping only; prosperityPassWorker.ts executes that burn itself and
// completes the row directly.
import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { randomUUID } from "crypto";
import { ethers } from "ethers";
import { supabase } from "./supabaseClient";

const CONTRACT_ADDRESS =
  process.env.MINIPOINTS_V2_ADDRESS ?? "0xab93400000751fc17918940C202A66066885d628";

const LOCK_NAME = "default";
const LOCK_LEASE_SECONDS = 300;
const MAX_JOB_ATTEMPTS = 6;
const TX_TIMEOUT_MS = 60_000;
const RECEIPT_POLL_MS = 5_000;
const STALLED_JOB_AGE_MS = LOCK_LEASE_SECONDS * 1000 * 2;
const SUPABASE_TIMEOUT_MS = Number(process.env.BURN_WORKER_SUPABASE_TIMEOUT_MS ?? "20000");

const RPC_URLS = [
  "https://forno.celo.org",
  "https://rpc.ankr.com/celo",
];

const BURN_ABI = [
  "function burn(address account, uint256 amount) external",
  "error Blacklisted()",
  "error Unauthorized()",
  "error NullAddress()",
];

const BLACKLISTED_SELECTOR = ethers.id("Blacklisted()").slice(0, 10).toLowerCase();
const UNAUTHORIZED_SELECTOR = ethers.id("Unauthorized()").slice(0, 10).toLowerCase();
const NULL_ADDRESS_SELECTOR = ethers.id("NullAddress()").slice(0, 10).toLowerCase();

type FailureKind = "blacklisted" | "unauthorized" | "null-address" | "transient-rpc" | "unknown";

// ── Wallet — reuses the same key mint uses when no dedicated burn key is set ──
const BURN_PK = process.env.BURNER_PK ?? process.env.MINTER_PK_1 ?? process.env.PRIVATE_KEY;
if (!BURN_PK) throw new Error("[burnWorker] No burner PK configured");

const provider = new ethers.JsonRpcProvider(RPC_URLS[0]);
const wallet = new ethers.Wallet(BURN_PK, provider);
const contract = new ethers.Contract(CONTRACT_ADDRESS, BURN_ABI, wallet);

// ── Helpers (mirrors mintWorker.ts) ───────────────────────────────────────────
function getErrorDataHex(err: any): string {
  const candidates = [err?.data, err?.error?.data, err?.info?.error?.data, err?.receipt?.revertReason];
  for (const value of candidates) {
    if (typeof value === "string" && value.startsWith("0x")) return value.toLowerCase();
  }
  return "";
}

function isBlacklistedError(err: any): boolean {
  if (err?.errorName === "Blacklisted") return true;
  const msg: string = (err?.shortMessage ?? err?.message ?? "").toLowerCase();
  const data = getErrorDataHex(err);
  return msg.includes("blacklisted") || msg.includes(BLACKLISTED_SELECTOR) || data.startsWith(BLACKLISTED_SELECTOR);
}

function classifyFailure(err: any): FailureKind {
  if (isBlacklistedError(err)) return "blacklisted";
  const data = getErrorDataHex(err);
  if (data.startsWith(UNAUTHORIZED_SELECTOR)) return "unauthorized";
  if (data.startsWith(NULL_ADDRESS_SELECTOR)) return "null-address";
  if (isTransientError(err)) return "transient-rpc";
  return "unknown";
}

function describeFailure(err: any): string {
  const kind = classifyFailure(err);
  const msg = err?.shortMessage ?? err?.message ?? "error";
  return kind === "unknown" ? msg : `${kind}: ${msg}`;
}

function isTransientError(err: any): boolean {
  const msg: string = (err?.shortMessage ?? err?.message ?? "").toLowerCase();
  return (
    msg.includes("503") || msg.includes("service unavailable") || msg.includes("could not coalesce") ||
    msg.includes("timeout") || msg.includes("timed out") || msg.includes("network error") ||
    msg.includes("econnreset") || msg.includes("econnrefused") || msg.includes("etimedout") ||
    msg.includes("backend is currently healthy")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(operation: PromiseLike<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function waitForReceiptWithFallback(txHash: string, label: string) {
  const deadline = Date.now() + TX_TIMEOUT_MS;
  let lastErr: any = null;

  while (Date.now() < deadline) {
    for (const url of RPC_URLS) {
      try {
        const p = new ethers.JsonRpcProvider(url);
        const receipt = await withTimeout(p.getTransactionReceipt(txHash), RECEIPT_POLL_MS, `${label} receipt poll ${url}`);
        if (receipt) return receipt;
      } catch (err: any) {
        lastErr = err;
        if (!isTransientError(err)) throw err;
      }
    }
    await sleep(RECEIPT_POLL_MS);
  }
  if (lastErr) throw lastErr;
  throw new Error(`Timed out waiting for receipt: ${txHash}`);
}

// ── Payload-kind side effects — mirrors mintWorker.ts's applyBatchPayloads ────
async function applyJobSideEffect(job: any, txHash: string) {
  if (job.payload?.kind === "voucher_issue") {
    const voucherId = job.payload.voucher_id;
    const { error } = await withTimeout(
      supabase
        .from("issued_vouchers")
        .update({ status: "issued", burn_tx_hash: txHash })
        .eq("id", voucherId)
        .eq("status", "pending"),
      SUPABASE_TIMEOUT_MS,
      `promote voucher ${voucherId}`,
    );
    if (error) {
      // Burn confirmed on-chain but promote failed — same recovery path the
      // (formerly synchronous) issue route used: leave it for reconciliation
      // rather than lose track of a completed burn.
      console.error(`[burnWorker] promote voucher ${voucherId} failed after confirmed burn — needs reconciliation`, error.message);
      await withTimeout(
        supabase
          .from("issued_vouchers")
          .update({ burn_tx_hash: txHash, recovery_state: "burn_confirmed_promote_failed" })
          .eq("id", voucherId)
          .eq("status", "pending"),
        SUPABASE_TIMEOUT_MS,
        `record recovery state ${voucherId}`,
      );
    }
  }
  // passport_burn: no side effect here — prosperityPassWorker.ts owns that
  // burn's execution end-to-end and is never claimed by this worker.
}

// ── Lock / stalled-job management ─────────────────────────────────────────────
let currentLockOwner: string | null = null;

export async function releaseCurrentBurnLock() {
  if (!currentLockOwner) return;
  const owner = currentLockOwner;
  try {
    await withTimeout(
      supabase.rpc("release_minipoint_burn_queue_lock", { p_lock_name: LOCK_NAME, p_owner: owner }),
      SUPABASE_TIMEOUT_MS,
      "release burn queue lock on shutdown",
    );
  } catch {
    // best-effort
  }
  if (currentLockOwner === owner) currentLockOwner = null;
}

async function clearStaleLockOnStartup() {
  try {
    await withTimeout(
      supabase.from("minipoint_burn_queue_locks").update({ locked_until: new Date().toISOString() }).eq("lock_name", LOCK_NAME),
      SUPABASE_TIMEOUT_MS,
      "clear stale burn queue lock on startup",
    );
  } catch {
    // ignore — lock will expire on its own
  }
}

async function resetStalledJobs() {
  const cutoff = new Date(Date.now() - STALLED_JOB_AGE_MS).toISOString();
  const { data, error } = await withTimeout(
    supabase
      .from("minipoint_burn_jobs")
      .update({ status: "pending", processing_by: null, processing_started_at: null })
      .eq("status", "processing")
      .lt("updated_at", cutoff)
      .select("id"),
    SUPABASE_TIMEOUT_MS,
    "reset stalled burn jobs",
  );
  if (error) throw error;
  const count = data?.length ?? 0;
  if (count > 0) console.log(`[burnWorker] Unstuck ${count} stalled jobs`);
}

async function permanentlyFail(jobId: string, reason: string) {
  await withTimeout(
    supabase.rpc("fail_minipoint_burn_job", { p_job_id: jobId, p_error: reason }),
    SUPABASE_TIMEOUT_MS,
    `fail burn job ${jobId}`,
  );
}

let isRunning = false;

export async function runBurnDrain() {
  if (isRunning) {
    console.log("[burnWorker] Already running, skipping");
    return;
  }
  isRunning = true;
  const owner = randomUUID();

  try {
    const { data: acquired, error: acquireError } = await withTimeout(
      supabase.rpc("acquire_minipoint_burn_queue_lock", { p_lock_name: LOCK_NAME, p_owner: owner, p_lease_seconds: LOCK_LEASE_SECONDS }),
      SUPABASE_TIMEOUT_MS,
      "acquire burn queue lock",
    );
    if (acquireError) throw acquireError;
    if (!acquired) {
      console.log("[burnWorker] Lock busy, skipping this run");
      return;
    }
    currentLockOwner = owner;

    await resetStalledJobs();

    while (true) {
      const job = await withTimeout(
        supabase.rpc("claim_next_minipoint_burn_job", { p_lock_name: LOCK_NAME, p_owner: owner }),
        SUPABASE_TIMEOUT_MS,
        "claim next burn job",
      ).then((r) => {
        if (r.error) throw r.error;
        const rows = r.data as any[] | null;
        return rows && rows.length > 0 ? rows[0] : null;
      });

      if (!job) {
        console.log("[burnWorker] Queue empty, done.");
        break;
      }

      try {
        console.log(`[burnWorker] Burning ${job.points} for ${job.user_address} (job ${job.id})…`);
        const tx = await contract.burn(job.user_address, ethers.parseUnits(String(job.points), 18));
        const receipt = await waitForReceiptWithFallback(tx.hash, `job ${job.id}`);
        const txHash: string = receipt.hash ?? tx.hash;

        await applyJobSideEffect(job, txHash);
        await withTimeout(
          supabase.rpc("complete_minipoint_burn_job", { p_job_id: job.id, p_tx_hash: txHash }),
          SUPABASE_TIMEOUT_MS,
          `complete burn job ${job.id}`,
        );
        console.log(`[burnWorker] ✓ Job ${job.id} confirmed: ${txHash}`);
      } catch (err: any) {
        const kind = classifyFailure(err);
        const reason = describeFailure(err);
        console.error(`[burnWorker] ✗ Job ${job.id} (${job.user_address}): ${reason}`);

        if (kind === "blacklisted" || kind === "unauthorized" || kind === "null-address") {
          await permanentlyFail(job.id, reason);
        } else if ((job.attempts ?? 0) >= MAX_JOB_ATTEMPTS) {
          await permanentlyFail(job.id, reason);
        } else {
          const delay = Math.min(30, 2 ** Math.max(1, job.attempts ?? 1));
          await withTimeout(
            supabase.rpc("retry_minipoint_burn_job", { p_job_id: job.id, p_error: reason, p_delay_seconds: delay }),
            SUPABASE_TIMEOUT_MS,
            `retry burn job ${job.id}`,
          );
        }
      }
    }
  } catch (err: any) {
    console.error("[burnWorker] Fatal error:", err?.message ?? err);
  } finally {
    if (currentLockOwner) {
      await withTimeout(
        supabase.rpc("release_minipoint_burn_queue_lock", { p_lock_name: LOCK_NAME, p_owner: currentLockOwner }),
        SUPABASE_TIMEOUT_MS,
        "release burn queue lock",
      ).catch(() => {});
      currentLockOwner = null;
    }
    isRunning = false;
  }
}

export async function startBurnWorker() {
  console.log("[burnWorker] Starting — runs every minute");
  await clearStaleLockOnStartup();
  runBurnDrain().catch(console.error);
  cron.schedule("* * * * *", () => {
    runBurnDrain().catch(console.error);
  });
}
