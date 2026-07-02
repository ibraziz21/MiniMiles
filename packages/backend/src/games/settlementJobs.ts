// DB layer for skill_game_settlement_jobs.
// This module only talks to Supabase; all signing + chain interaction stays in routes.ts.

import { supabase } from "../supabaseClient";

const MAX_JOB_ATTEMPTS = Number(process.env.SKILL_GAMES_MAX_SETTLE_ATTEMPTS ?? "12");
const JOB_LEASE_MS = Number(process.env.SKILL_GAMES_SETTLE_CLAIM_LEASE_SECONDS ?? "90") * 1000;
// Exponential back-off base; capped at 5 minutes so workers stay responsive.
const BACKOFF_BASE_S = 30;
const BACKOFF_CAP_S = 300;

export type SettlementJobStatus =
  | "queued"
  | "leased"
  | "submitted"
  | "confirmed"
  | "retrying"
  | "failed"
  | "manual_review";

export type SettlementJobRow = {
  id: string;
  session_id: string;
  wallet_address: string;
  game_type: string;
  score: number;
  reward_miles: number;
  reward_stable: string | number; // PostgreSQL NUMERIC → string from Supabase
  status: SettlementJobStatus;
  tx_hash: string | null;
  attempts: number;
  last_error: string | null;
  leased_at: string | null;
  lease_owner: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------------------
// Upsert — insert if not exists, return existing row on conflict.
// Never overwrites a completed job (confirmed / failed).
// ---------------------------------------------------------------------------
export async function upsertSettlementJob(input: {
  sessionId: string;
  walletAddress: string;
  gameType: string;
  score: number;
  rewardMiles: number;
  rewardStable: number;
}): Promise<SettlementJobRow | null> {
  const now = new Date().toISOString();
  const payload = {
    session_id:     input.sessionId,
    wallet_address: input.walletAddress.toLowerCase(),
    game_type:      input.gameType,
    score:          Math.round(input.score),
    reward_miles:   Math.round(input.rewardMiles),
    reward_stable:  input.rewardStable,
    status:         "queued" as const,
    next_attempt_at: now,
    updated_at:     now,
  };

  const { data, error } = await supabase
    .from("skill_game_settlement_jobs")
    .insert(payload)
    .select()
    .maybeSingle();

  if (!error) return data as SettlementJobRow | null;

  // Unique constraint violation → job already exists; return the existing row unchanged.
  if ((error as any).code === "23505") {
    const { data: existing, error: fetchErr } = await supabase
      .from("skill_game_settlement_jobs")
      .select()
      .eq("session_id", input.sessionId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    return existing as SettlementJobRow | null;
  }

  throw error;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------
export async function getSettlementJob(sessionId: string): Promise<SettlementJobRow | null> {
  const { data, error } = await supabase
    .from("skill_game_settlement_jobs")
    .select()
    .eq("session_id", sessionId)
    .maybeSingle();
  if (error) throw error;
  return data as SettlementJobRow | null;
}

// ---------------------------------------------------------------------------
// Atomic lease — select due candidates, then claim each individually so only
// one worker wins per row. Returns fully-populated leased rows.
// ---------------------------------------------------------------------------
export async function leaseSettlementJobs(ownerId: string, limit = 5): Promise<SettlementJobRow[]> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - JOB_LEASE_MS).toISOString();
  const nowIso = now.toISOString();

  const { data: candidates, error: queryErr } = await supabase
    .from("skill_game_settlement_jobs")
    .select("id")
    .in("status", ["queued", "retrying"])
    .lte("next_attempt_at", nowIso)
    .or(`leased_at.is.null,leased_at.lt."${leaseCutoff}"`)
    .lt("attempts", MAX_JOB_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(limit * 3); // over-select to absorb concurrent races

  if (queryErr) throw queryErr;
  if (!candidates?.length) return [];

  const leased: SettlementJobRow[] = [];
  for (const candidate of candidates) {
    if (leased.length >= limit) break;
    const { data: updated, error: updateErr } = await supabase
      .from("skill_game_settlement_jobs")
      .update({
        status:      "leased",
        leased_at:   nowIso,
        lease_owner: ownerId,
        updated_at:  nowIso,
      })
      .eq("id", candidate.id)
      .in("status", ["queued", "retrying"])
      .or(`leased_at.is.null,leased_at.lt."${leaseCutoff}"`)
      .select();

    if (updateErr) continue; // transient — skip, another worker may pick it up
    if (updated?.length) leased.push(updated[0] as SettlementJobRow);
  }
  return leased;
}

// ---------------------------------------------------------------------------
// Status updates
// ---------------------------------------------------------------------------
export async function markJobSubmitted(
  jobId: string,
  txHash: string,
  attempts: number,
): Promise<void> {
  await supabase
    .from("skill_game_settlement_jobs")
    .update({
      status:     "submitted",
      tx_hash:    txHash,
      attempts,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function markJobConfirmed(
  jobId: string,
  txHash: string,
  attempts: number,
): Promise<void> {
  await supabase
    .from("skill_game_settlement_jobs")
    .update({
      status:      "confirmed",
      tx_hash:     txHash,
      attempts,
      leased_at:   null,
      lease_owner: null,
      updated_at:  new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function markJobRetrying(
  jobId: string,
  lastError: string,
  attempts: number,
): Promise<void> {
  const status: SettlementJobStatus =
    attempts >= MAX_JOB_ATTEMPTS ? "manual_review" : "retrying";
  const backoffSec = Math.min(
    BACKOFF_CAP_S,
    BACKOFF_BASE_S * Math.pow(2, Math.min(attempts - 1, 4)),
  );
  const nextAttempt = new Date(Date.now() + backoffSec * 1000).toISOString();

  await supabase
    .from("skill_game_settlement_jobs")
    .update({
      status,
      last_error:      lastError,
      attempts,
      leased_at:       null,
      lease_owner:     null,
      next_attempt_at: status === "retrying" ? nextAttempt : new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    })
    .eq("id", jobId);
}
