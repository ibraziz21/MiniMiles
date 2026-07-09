// lib/server/crackpotPayoutWorker.ts
//
// Durable settlement worker for CrackPot winner payouts.
//
// State machine for a payout job:
//   queued  ──► processing ──► succeeded
//                          └─► failed   (retryable; next_attempt_at advances)
//                          └─► manual_review (exhausted retries)
//
// The cycle status mirrors the job:
//   active    → settling (when job is enqueued)
//   settling  → cracked  (when job succeeds and CycleCracked decoded)
//   settling  → settling (when job fails/retries — cycle stays settling)
//
// Race safety:
//   • Idempotency key prevents duplicate jobs per cycle.
//   • The "claim" step is a CAS update (WHERE status = 'queued' AND id = ?) so
//     two concurrent workers cannot both claim the same job.
//   • If declareWinner reverts with NoCycleActive we re-read chain; if the
//     chain already shows the cycle as CRACKED (status=1) we finalise from the
//     existing on-chain data rather than failing.

import { supabase } from "@/lib/supabaseClient";
import {
  contractDeclareWinner,
  contractGetActiveCycle,
  ContractVersion,
  type ContractVersionType,
} from "@/lib/server/crackpotContract";
import { chainPotToDb } from "@/lib/server/crackpotCycleSync";
import type { CrackPotVersion } from "@/lib/crackpotTypes";

// ── Types ─────────────────────────────────────────────────────────────────────

export type PayoutJobStatus =
  | "queued"
  | "processing"
  | "succeeded"
  | "failed"
  | "manual_review";

export type RawPayoutJob = {
  id:                 string;
  cycle_id:           string;
  chain_id:           number;
  contract_cycle_id:  number;
  contract_version:   number;
  winner_address:     string;
  winner_guesses:     number;
  idempotency_key:    string;
  status:             PayoutJobStatus;
  tx_hash:            string | null;
  payout_amount:      number | null;
  attempts:           number;
  last_error:         string | null;
  leased_at:          string | null;
  lease_owner:        string | null;
  next_attempt_at:    string;
  created_at:         string;
  updated_at:         string;
};

export type ProcessPayoutJobResult = {
  status: Extract<PayoutJobStatus, "succeeded" | "failed" | "manual_review">;
};

export type EnqueuePayoutParams = {
  cycleId:          string;   // DB UUID
  chainId:          number;
  contractCycleId:  number;
  contractVersion:  number;
  winnerAddress:    string;   // checksummed or lowercase — stored lowercase
  winnerGuesses:    number;
};

const MAX_ATTEMPTS    = 5;
const RETRY_DELAY_MS  = 30_000; // 30 s between retries

// ── Enqueue ───────────────────────────────────────────────────────────────────

/**
 * Enqueue a payout job and atomically mark the cycle as 'settling'.
 *
 * Idempotent: if a job already exists for this cycle (same idempotency_key)
 * the existing row is returned and the cycle is left as-is.
 *
 * The caller (guess route) must confirm `isCorrect` before calling this.
 */
export async function enqueuePayoutJob(
  params: EnqueuePayoutParams,
): Promise<RawPayoutJob | null> {
  const key = `crackpot:${params.chainId}:${params.contractVersion}:${params.contractCycleId}`;

  // 1. Mark cycle settling (WHERE status = 'active' so settling is idempotent).
  const { error: cycleErr } = await supabase
    .from("crackpot_cycles")
    .update({ status: "settling" })
    .eq("id", params.cycleId)
    .eq("status", "active");

  if (cycleErr) {
    console.warn("[crackpotPayoutWorker] cycle settling update failed:", cycleErr.message);
    // Non-fatal — cycle might already be settling from a parallel request.
  }

  // 2. Insert job row (ON CONFLICT DO NOTHING via unique idempotency_key).
  const { data, error } = await supabase
    .from("crackpot_payout_jobs")
    .upsert(
      {
        cycle_id:          params.cycleId,
        chain_id:          params.chainId,
        contract_cycle_id: params.contractCycleId,
        contract_version:  params.contractVersion,
        winner_address:    params.winnerAddress.toLowerCase(),
        winner_guesses:    params.winnerGuesses,
        idempotency_key:   key,
        status:            "queued",
        next_attempt_at:   new Date().toISOString(),
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select("*")
    .maybeSingle();

  if (error) throw new Error(`[crackpotPayoutWorker] enqueue failed: ${error.message}`);

  // If upsert ignored a duplicate, fetch the existing row.
  if (!data) {
    const { data: existing, error: fetchErr } = await supabase
      .from("crackpot_payout_jobs")
      .select("*")
      .eq("idempotency_key", key)
      .maybeSingle();

    if (fetchErr) throw new Error(`[crackpotPayoutWorker] fetch existing job failed: ${fetchErr.message}`);
    return existing as RawPayoutJob | null;
  }

  return data as RawPayoutJob;
}

// ── Lease ─────────────────────────────────────────────────────────────────────

/**
 * Claim the next runnable job using a compare-and-swap update.
 * Returns null if no runnable job is available or if another worker claimed it first.
 */
export async function leaseNextPayoutJob(
  leaseOwner: string = "worker",
): Promise<RawPayoutJob | null> {
  // Find the oldest runnable job.
  const { data: candidate } = await supabase
    .from("crackpot_payout_jobs")
    .select("id")
    .in("status", ["queued", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!candidate) return null;

  // CAS claim: only succeeds if the row is still in a runnable state.
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("crackpot_payout_jobs")
    .update({
      status:      "processing",
      leased_at:   now,
      lease_owner: leaseOwner,
    })
    .eq("id", candidate.id)
    .in("status", ["queued", "failed"])
    .select("*")
    .maybeSingle();

  if (error) {
    console.warn("[crackpotPayoutWorker] lease CAS failed:", error.message);
    return null;
  }

  return data as RawPayoutJob | null;
}

// ── Process ───────────────────────────────────────────────────────────────────

/**
 * Execute one payout job:
 *   1. Call declareWinner() on-chain.
 *   2. Decode CycleCracked event.
 *   3. Finalize DB (cycle → cracked, job → succeeded).
 *
 * On any error, marks the job failed/retrying or manual_review.
 */
export async function processPayoutJob(job: RawPayoutJob): Promise<ProcessPayoutJobResult> {
  const version: ContractVersionType =
    job.contract_version === ContractVersion.USDT ? ContractVersion.USDT : ContractVersion.MILES;

  const dbVersion: CrackPotVersion =
    job.contract_version === ContractVersion.USDT ? "usdt" : "miles";

  try {
    const { txHash, cycleCracked } = await contractDeclareWinner(
      version,
      job.winner_address as `0x${string}`,
      job.winner_guesses,
      job.chain_id,
    );

    // Verify the decoded event matches what we expected.
    if (Number(cycleCracked.cycleId) !== job.contract_cycle_id) {
      throw new Error(
        `[crackpotPayoutWorker] CycleCracked cycleId mismatch: got ${cycleCracked.cycleId}, expected ${job.contract_cycle_id}`,
      );
    }
    if (cycleCracked.winner.toLowerCase() !== job.winner_address.toLowerCase()) {
      throw new Error(
        `[crackpotPayoutWorker] CycleCracked winner mismatch: got ${cycleCracked.winner}, expected ${job.winner_address}`,
      );
    }

    const payoutDb = chainPotToDb(cycleCracked.payout, dbVersion);

    await finalizePayoutJob(job.id, job.cycle_id, txHash, payoutDb, cycleCracked.winner);
    return { status: "succeeded" };
  } catch (err: any) {
    const errMsg = String(err?.shortMessage ?? err?.message ?? "unknown error");

    // If the chain says NoCycleActive, the cycle may already have been cracked
    // by a prior worker attempt — check and finalise.
    if (/NoCycleActive|no active cycle/i.test(errMsg)) {
      const recovered = await recoverAlreadyCrackedCycle(job, dbVersion);
      if (recovered) return { status: "succeeded" };
    }

    const status = await failPayoutJob(job.id, errMsg, job.attempts + 1);
    return { status };
  }
}

// ── Finalize ──────────────────────────────────────────────────────────────────

async function finalizePayoutJob(
  jobId:         string,
  cycleId:       string,
  txHash:        string,
  payoutDb:      number,
  winner:        string,
): Promise<void> {
  const now = new Date().toISOString();

  // Update cycle: cracked.
  await supabase
    .from("crackpot_cycles")
    .update({
      status:         "cracked",
      winner_tx_hash: txHash,
      payout_amount:  payoutDb,
      cracked_at:     now,
    })
    .eq("id", cycleId)
    .eq("status", "settling");

  // Update job: succeeded.
  await supabase
    .from("crackpot_payout_jobs")
    .update({
      status:        "succeeded",
      tx_hash:       txHash,
      payout_amount: payoutDb,
    })
    .eq("id", jobId);
}

// ── Fail / retry ──────────────────────────────────────────────────────────────

async function failPayoutJob(
  jobId:     string,
  errMsg:    string,
  attempts:  number,
): Promise<Extract<PayoutJobStatus, "failed" | "manual_review">> {
  const newStatus: Extract<PayoutJobStatus, "failed" | "manual_review"> =
    attempts >= MAX_ATTEMPTS ? "manual_review" : "failed";

  const backoffMs  = Math.min(RETRY_DELAY_MS * 2 ** (attempts - 1), 5 * 60_000);
  const nextTry    = new Date(Date.now() + backoffMs).toISOString();

  await supabase
    .from("crackpot_payout_jobs")
    .update({
      status:          newStatus,
      last_error:      errMsg.slice(0, 500),
      attempts,
      leased_at:       null,
      lease_owner:     null,
      next_attempt_at: newStatus === "failed" ? nextTry : undefined,
    })
    .eq("id", jobId);

  return newStatus;
}

// ── Race recovery ─────────────────────────────────────────────────────────────

/**
 * If declareWinner reverts with NoCycleActive it means a prior attempt
 * already sent the tx.  Try to recover by checking the chain cycle status.
 * Returns true if we successfully finalised from on-chain data.
 */
async function recoverAlreadyCrackedCycle(
  job:       RawPayoutJob,
  dbVersion: CrackPotVersion,
): Promise<boolean> {
  try {
    const version: ContractVersionType =
      job.contract_version === ContractVersion.USDT ? ContractVersion.USDT : ContractVersion.MILES;

    // activeCycleId = 0 when the cycle is cracked (cleared in declareWinner).
    const onChain = await contractGetActiveCycle(version, job.chain_id);
    if (onChain && Number(onChain.id) === job.contract_cycle_id) {
      // Cycle still active — not a recovery situation.
      return false;
    }

    // Cycle no longer active — treat as already cracked.  We lack the exact
    // payout amount here (cycle.potBalance is 0 post-cracking), so mark the
    // job succeeded with the winner we know and leave payout_amount null.
    const now = new Date().toISOString();

    await supabase
      .from("crackpot_cycles")
      .update({
        status:     "cracked",
        cracked_at: now,
      })
      .eq("id", job.cycle_id)
      .eq("status", "settling");

    await supabase
      .from("crackpot_payout_jobs")
      .update({
        status:     "succeeded",
        last_error: "recovered: cycle already cracked on-chain",
      })
      .eq("id", job.id);

    return true;
  } catch {
    return false;
  }
}

// ── Reveal helpers ────────────────────────────────────────────────────────────

/**
 * Reveal the secret preimage for an ended cycle.
 * Only safe to call after status is 'cracked' or 'dead'.
 * Returns null if the cycle does not exist or is still active.
 */
export async function revealCycleSecret(cycleId: string): Promise<{
  secretCode:          [number, number, number, number];
  secretSalt:          string;
  secretCommitment:    string;
  commitmentAlgorithm: string;
  chainId:             number;
  contractAddress:     string;
  contractVersion:     number;
  expiresAt:           string;
} | null> {
  const { data, error } = await supabase
    .from("crackpot_cycles")
    .select(
      "id, status, chain_id, contract_version, contract_cycle_id, " +
      "secret_code, secret_salt, secret_commitment, commitment_algorithm, expires_at",
    )
    .eq("id", cycleId)
    .in("status", ["cracked", "dead"])
    .maybeSingle();

  if (error || !data) return null;
  const row = data as any;

  // Mark revealed.
  await supabase
    .from("crackpot_cycles")
    .update({ secret_revealed_at: new Date().toISOString() })
    .eq("id", cycleId)
    .is("secret_revealed_at", null);

  const contractAddr =
    row.chain_id === 8453
      ? (process.env.NEXT_PUBLIC_BASE_CRACKPOT_ADDRESS ?? "")
      : (process.env.NEXT_PUBLIC_CRACKPOT_ADDRESS ?? "");

  return {
    secretCode:          row.secret_code as [number, number, number, number],
    secretSalt:          row.secret_salt as string,
    secretCommitment:    row.secret_commitment as string,
    commitmentAlgorithm: row.commitment_algorithm ?? "",
    chainId:             row.chain_id as number,
    contractAddress:     contractAddr,
    contractVersion:     row.contract_version as number,
    expiresAt:           row.expires_at as string,
  };
}
