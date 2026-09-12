// lib/server/legacyMintJobGuard.ts
//
// Prevents the sponsored mint queue and the self-claim path from ever paying
// the same logical completion (docs/all-quests-self-claim-spec.md §5.3 step
// 8, §10, goal 6). Every family in the current rollout phase historically
// enqueues through claimQueuedDailyReward (lib/minipointQueue.ts), whose
// idempotency key is `daily:{questId}:{userLc}:{scopeKey}` — this guard reads
// that exact key so a voucher can never be issued while a legacy job for the
// same completion may still mint.

import { supabase } from "@/lib/supabaseClient";

export type LegacyMintJobConflict =
  | { conflict: false }
  | { conflict: true; status: "already" | "processing"; jobId: string };

/** The idempotency key claimQueuedDailyReward uses for every daily-scoped family. */
export function legacyDailyIdempotencyKey(questId: string, userAddress: string, scopeKey: string): string {
  return `daily:${questId}:${userAddress.toLowerCase()}:${scopeKey}`;
}

/**
 * Checks minipoint_mint_jobs for a conflicting legacy job before a voucher
 * may be issued.
 *
 * - pending/processing: a sponsored mint may still land — block issuance.
 * - completed: the reward was already sponsor-delivered — report "already".
 * - failed: every retry is exhausted with no successful mint — conclusively
 *   safe to allow self-claim.
 * - no row at all: safe to allow self-claim.
 */
export async function checkLegacyMintJobConflict(idempotencyKey: string): Promise<LegacyMintJobConflict> {
  const { data, error } = await supabase
    .from("minipoint_mint_jobs")
    .select("id, status")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { conflict: false };

  if (data.status === "completed") {
    return { conflict: true, status: "already", jobId: data.id };
  }
  if (data.status === "pending" || data.status === "processing") {
    return { conflict: true, status: "processing", jobId: data.id };
  }
  // "failed" — every retry exhausted with no mint; self-claim may proceed.
  return { conflict: false };
}
