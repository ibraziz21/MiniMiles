import { supabase } from "../supabaseClient";

const MAX_JOB_ATTEMPTS = Number(process.env.FARKLE_MAX_SETTLE_ATTEMPTS ?? "12");
const JOB_LEASE_MS = Number(process.env.FARKLE_SETTLE_CLAIM_LEASE_SECONDS ?? "90") * 1000;
const BACKOFF_BASE_S = 30;
const BACKOFF_CAP_S = 300;

export type FarkleSettlementJobStatus =
  | "queued"
  | "leased"
  | "submitted"
  | "confirmed"
  | "retrying"
  | "failed"
  | "manual_review";

export type FarkleSettlementJobRow = {
  id: string;
  match_id: string;
  mode_key: string;
  winner_address: string;
  loser_address: string;
  winner_score: number;
  loser_score: number;
  win_miles: number;
  los_miles: number;
  win_credit_cents: number;
  chain_id: number;
  status: FarkleSettlementJobStatus;
  tx_hash: string | null;
  attempts: number;
  last_error: string | null;
  leased_at: string | null;
  lease_owner: string | null;
  next_attempt_at: string;
  created_at: string;
  updated_at: string;
};

export function isMissingFarkleSettlementJobsTable(error: unknown) {
  const e = error as { code?: string; message?: string; details?: string };
  const text = [e?.message, e?.details].filter(Boolean).join(" ").toLowerCase();
  return e?.code === "42P01" || e?.code === "PGRST205" || text.includes("farkle_settlement_jobs");
}

export async function upsertFarkleSettlementJob(input: {
  matchId: string;
  modeKey: string;
  winnerAddress: string;
  loserAddress: string;
  winnerScore: number;
  loserScore: number;
  winMiles: number;
  losMiles: number;
  winCreditCents: number;
  chainId: number;
}): Promise<FarkleSettlementJobRow | null> {
  const now = new Date().toISOString();
  const payload = {
    match_id: input.matchId,
    mode_key: input.modeKey,
    winner_address: input.winnerAddress.toLowerCase(),
    loser_address: input.loserAddress.toLowerCase(),
    winner_score: Math.round(input.winnerScore),
    loser_score: Math.round(input.loserScore),
    win_miles: Math.round(input.winMiles),
    los_miles: Math.round(input.losMiles),
    win_credit_cents: Math.round(input.winCreditCents),
    chain_id: input.chainId,
    status: "queued" as const,
    next_attempt_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from("farkle_settlement_jobs")
    .insert(payload)
    .select()
    .maybeSingle();

  if (!error) return data as FarkleSettlementJobRow | null;

  if ((error as any).code === "23505") {
    const { data: existing, error: fetchErr } = await supabase
      .from("farkle_settlement_jobs")
      .select()
      .eq("match_id", input.matchId)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    return existing as FarkleSettlementJobRow | null;
  }

  throw error;
}

export async function getFarkleSettlementJob(matchId: string): Promise<FarkleSettlementJobRow | null> {
  const { data, error } = await supabase
    .from("farkle_settlement_jobs")
    .select()
    .eq("match_id", matchId)
    .maybeSingle();
  if (error) throw error;
  return data as FarkleSettlementJobRow | null;
}

export async function getFarkleSettlementJobById(jobId: string): Promise<FarkleSettlementJobRow | null> {
  const { data, error } = await supabase
    .from("farkle_settlement_jobs")
    .select()
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw error;
  return data as FarkleSettlementJobRow | null;
}

export async function listFarkleSettlementJobs(input: {
  statuses?: FarkleSettlementJobStatus[];
  limit?: number;
} = {}): Promise<FarkleSettlementJobRow[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  let query = supabase
    .from("farkle_settlement_jobs")
    .select()
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (input.statuses?.length) {
    query = query.in("status", input.statuses);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FarkleSettlementJobRow[];
}

export async function countFarkleSettlementJobsByStatus(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("farkle_settlement_jobs")
    .select("status");
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}

export async function leaseFarkleSettlementJobs(ownerId: string, limit = 5): Promise<FarkleSettlementJobRow[]> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - JOB_LEASE_MS).toISOString();
  const nowIso = now.toISOString();

  const { data: candidates, error: queryErr } = await supabase
    .from("farkle_settlement_jobs")
    .select("id")
    .in("status", ["queued", "retrying"])
    .lte("next_attempt_at", nowIso)
    .or(`leased_at.is.null,leased_at.lt."${leaseCutoff}"`)
    .lt("attempts", MAX_JOB_ATTEMPTS)
    .order("next_attempt_at", { ascending: true })
    .limit(limit * 3);

  if (queryErr) throw queryErr;
  if (!candidates?.length) return [];

  const leased: FarkleSettlementJobRow[] = [];
  for (const candidate of candidates) {
    if (leased.length >= limit) break;
    const { data: updated, error: updateErr } = await supabase
      .from("farkle_settlement_jobs")
      .update({
        status: "leased",
        leased_at: nowIso,
        lease_owner: ownerId,
        updated_at: nowIso,
      })
      .eq("id", candidate.id)
      .in("status", ["queued", "retrying"])
      .or(`leased_at.is.null,leased_at.lt."${leaseCutoff}"`)
      .select();

    if (updateErr) continue;
    if (updated?.length) leased.push(updated[0] as FarkleSettlementJobRow);
  }

  return leased;
}

export async function markFarkleJobSubmitted(
  jobId: string,
  txHash: string,
  attempts: number,
): Promise<void> {
  await supabase
    .from("farkle_settlement_jobs")
    .update({
      status: "submitted",
      tx_hash: txHash,
      attempts,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function markFarkleJobConfirmed(
  jobId: string,
  txHash: string | null,
  attempts: number,
): Promise<void> {
  await supabase
    .from("farkle_settlement_jobs")
    .update({
      status: "confirmed",
      tx_hash: txHash,
      attempts,
      last_error: null,
      leased_at: null,
      lease_owner: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

export async function markFarkleJobRetrying(
  jobId: string,
  lastError: string,
  attempts: number,
): Promise<void> {
  const status: FarkleSettlementJobStatus =
    attempts >= MAX_JOB_ATTEMPTS ? "manual_review" : "retrying";
  const backoffSec = Math.min(
    BACKOFF_CAP_S,
    BACKOFF_BASE_S * Math.pow(2, Math.min(Math.max(0, attempts - 1), 4)),
  );
  const nextAttempt = new Date(Date.now() + backoffSec * 1000).toISOString();

  await supabase
    .from("farkle_settlement_jobs")
    .update({
      status,
      last_error: lastError.slice(0, 2000),
      attempts,
      leased_at: null,
      lease_owner: null,
      next_attempt_at: status === "retrying" ? nextAttempt : new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}
