// lib/server/dailyClaimIntents.ts
//
// Generic claim-intent lifecycle shared by every self-claim quest family
// (docs/all-quests-self-claim-spec.md §4, §6, §7), generalized in place from
// the daily-check-in-only engine (docs/daily-checkin-self-claim-spec.md §2,
// §6) per the "one engine, not a second implementation" requirement in
// all-quests-self-claim-spec.md §5.1. The table keeps its historical name
// and every pre-existing export keeps its exact signature — daily check-in's
// confirm/claim-status routes and tests call these unchanged.
//
// An intent is not a completed reward — only a successful finalizer run
// (dispatched by finalizer_kind) makes the quest "done". On-chain state is
// the mint authority: if a transaction hash is missing but
// claimed(user, claimNonce) is true, the contract's atomic claim+mint
// guarantees the reward was actually delivered.

import { decodeEventLog } from "viem";
import { supabase } from "@/lib/supabaseClient";
import { celoClient } from "@/lib/celoClient";
import { DAILY_QUEST_CLAIMER_ABI, previousScopeKeyFor } from "@/lib/dailyQuestClaimer";
import type { QuestVaultBoost } from "@/lib/server/questReward";
import { getClaimerAddress } from "@/lib/server/dailyClaimConfig";

// chain_confirmed sits between submitted and confirmed: the mint is already
// irreversible on-chain, but the local domain finalizer (daily_engagements
// upsert, streak advance, canonical delivery, etc.) may still need an
// idempotent retry independent of ever re-verifying the chain again.
export type ClaimIntentStatus = "issued" | "submitted" | "chain_confirmed" | "confirmed" | "expired";

export type ClaimIntentRow = {
  id: string;
  user_address: string;
  quest_id: string;
  // Legacy daily-only fields — nullable for every non-daily-checkin family.
  // New code reads scope_key/claim_nonce instead (all-quests spec §4 req #4).
  claim_date: string | null;
  day_nonce: string | null;
  scope_key: string;
  claim_nonce: string;
  claim_family: string;
  base_points: number;
  points_awarded: number;
  amount_wei: string;
  vault_boost: QuestVaultBoost;
  deadline: string;
  status: ClaimIntentStatus;
  tx_hash: string | null;
  last_error: string | null;
  finalizer_kind: string;
  finalizer_payload: Record<string, unknown>;
  eligibility_ref: string | null;
  chain_confirmed_at: string | null;
  legacy_job_id: string | null;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
};

function isDuplicateError(error: any) {
  return error?.code === "23505";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidClaimIntentId(id: string): boolean {
  return UUID_RE.test(id);
}

// ── Generic lookups ────────────────────────────────────────────────────────

/** Looks up an intent by the generic (wallet, quest, scope) unique key. */
export async function getIntentForScope(
  userAddress: string,
  questId: string,
  scopeKey: string,
): Promise<ClaimIntentRow | null> {
  const { data, error } = await supabase
    .from("daily_quest_claim_intents")
    .select("*")
    .eq("user_address", userAddress.toLowerCase())
    .eq("quest_id", questId)
    .eq("scope_key", scopeKey)
    .maybeSingle();

  if (error) throw error;
  return data as ClaimIntentRow | null;
}

/**
 * Daily check-in compatibility alias — for the daily_checkin family,
 * scope_key IS the UTC claim_date, so this is exactly getIntentForScope.
 * Kept as its own export so existing call sites/tests never had to change.
 */
export async function getIntentForDay(
  userAddress: string,
  questId: string,
  claimDate: string,
): Promise<ClaimIntentRow | null> {
  return getIntentForScope(userAddress, questId, claimDate);
}

/**
 * Looks up an intent by its opaque id, scoped to the session wallet. Used by
 * confirm/claim-status once a voucher has been issued so a transaction that
 * broadcasts before a scope boundary (UTC midnight, ISO week end) can confirm
 * just after it — a lookup keyed on "today"/"this week" would miss it, since
 * the server's current scope has since rolled over
 * (docs/daily-checkin-self-claim-spec.md §6). Returns null (rather than
 * throwing) on a not-found or wallet mismatch, so callers can fail closed the
 * same way as "no intent" without leaking whether a given id belongs to
 * someone else.
 */
export async function getIntentById(id: string, userAddress: string): Promise<ClaimIntentRow | null> {
  // daily_quest_claim_intents.id is a PostgreSQL uuid. Reject malformed input
  // before it reaches PostgREST, where it would otherwise become an invalid-
  // uuid database error and surface as a 500 from confirm/claim-status.
  if (!isValidClaimIntentId(id)) return null;

  const { data, error } = await supabase
    .from("daily_quest_claim_intents")
    .select("*")
    .eq("id", id)
    .eq("user_address", userAddress.toLowerCase())
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  const row = data as ClaimIntentRow;
  // Defense in depth: the query is wallet-scoped, but never trust a mocked,
  // proxied or unexpectedly shaped response to preserve that boundary.
  if (row.user_address.toLowerCase() !== userAddress.toLowerCase()) return null;
  return row;
}

/** Bounded list of a wallet's own nonterminal intents, for cross-device recovery (spec §5.4 /pending). */
export async function getPendingIntentsForWallet(
  userAddress: string,
  limit = 20,
): Promise<ClaimIntentRow[]> {
  const { data, error } = await supabase
    .from("daily_quest_claim_intents")
    .select("*")
    .eq("user_address", userAddress.toLowerCase())
    .in("status", ["issued", "submitted", "chain_confirmed"])
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as ClaimIntentRow[];
}

// ── Creation ───────────────────────────────────────────────────────────────

export type CreateGenericIntentOpts = {
  userAddress: string;
  questId: string;
  scopeKey: string;
  claimNonce: bigint;
  claimFamily: string;
  deadline: bigint;
  basePoints: number;
  awardedPoints: number;
  amountWei: bigint;
  vaultBoost: QuestVaultBoost;
  finalizerKind: string;
  finalizerPayload: Record<string, unknown>;
  eligibilityRef?: string;
  legacyJobId?: string;
  // Populated only for the daily_checkin family, for old-code compatibility.
  claimDate?: string;
  dayNonce?: bigint;
};

export async function createGenericIntent(opts: CreateGenericIntentOpts): Promise<ClaimIntentRow> {
  const userLc = opts.userAddress.toLowerCase();
  const { data, error } = await supabase
    .from("daily_quest_claim_intents")
    .insert({
      user_address: userLc,
      quest_id: opts.questId,
      scope_key: opts.scopeKey,
      claim_nonce: opts.claimNonce.toString(),
      claim_family: opts.claimFamily,
      base_points: opts.basePoints,
      points_awarded: opts.awardedPoints,
      amount_wei: opts.amountWei.toString(),
      vault_boost: opts.vaultBoost,
      deadline: opts.deadline.toString(),
      status: "issued",
      finalizer_kind: opts.finalizerKind,
      finalizer_payload: opts.finalizerPayload,
      eligibility_ref: opts.eligibilityRef ?? null,
      legacy_job_id: opts.legacyJobId ?? null,
      claim_date: opts.claimDate ?? null,
      day_nonce: opts.dayNonce !== undefined ? opts.dayNonce.toString() : null,
    })
    .select("*")
    .single();

  if (error && !isDuplicateError(error)) throw error;
  if (data) return data as ClaimIntentRow;

  // Concurrent first request already created it — reuse the frozen row
  // (decision 3: a retry never recalculates the reward).
  const existing = await getIntentForScope(userLc, opts.questId, opts.scopeKey);
  if (!existing) throw new Error("Failed to create or find claim intent");
  return existing;
}

/**
 * Daily check-in compatibility alias. Freezes claim_date/day_nonce onto the
 * row (old code/columns) in addition to the generic scope_key/claim_nonce
 * (scope_key = claimDate, claim_nonce = dayNonce for this family), and always
 * targets the daily_engagement finalizer — exactly today's behavior.
 */
export async function createIntent(opts: {
  userAddress: string;
  questId: string;
  claimDate: string;
  dayNonce: bigint;
  deadline: bigint;
  basePoints: number;
  awardedPoints: number;
  amountWei: bigint;
  vaultBoost: QuestVaultBoost;
}): Promise<ClaimIntentRow> {
  return createGenericIntent({
    userAddress: opts.userAddress,
    questId: opts.questId,
    scopeKey: opts.claimDate,
    claimNonce: opts.dayNonce,
    claimFamily: "daily_checkin",
    deadline: opts.deadline,
    basePoints: opts.basePoints,
    awardedPoints: opts.awardedPoints,
    amountWei: opts.amountWei,
    vaultBoost: opts.vaultBoost,
    finalizerKind: "daily_engagement",
    finalizerPayload: { questId: opts.questId, claimDate: opts.claimDate },
    claimDate: opts.claimDate,
    dayNonce: opts.dayNonce,
  });
}

// ── Updates ────────────────────────────────────────────────────────────────

async function updateIntent(id: string, patch: Record<string, unknown>): Promise<ClaimIntentRow> {
  const { data, error } = await supabase
    .from("daily_quest_claim_intents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as ClaimIntentRow;
}

/**
 * Applies a non-terminal transition only if the database row still matches the
 * snapshot that was reconciled. confirm, claim-status and the stale sweep can
 * all operate on the same intent concurrently; without this compare-and-set,
 * a late pending/revert result could move a freshly confirmed row backwards
 * (all-quests-self-claim-spec.md §6: "a late pending/revert result cannot
 * move a confirmed row backward").
 *
 * If another request won the race, return its current row rather than
 * treating the harmless lost race as an error.
 */
async function updateIntentIfCurrent(
  intent: ClaimIntentRow,
  patch: Record<string, unknown>,
): Promise<ClaimIntentRow> {
  const baseQuery = supabase
    .from("daily_quest_claim_intents")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", intent.id)
    .eq("user_address", intent.user_address.toLowerCase())
    .eq("status", intent.status);
  const guardedQuery = intent.tx_hash === null
    ? baseQuery.is("tx_hash", null)
    : baseQuery.eq("tx_hash", intent.tx_hash);
  const { data, error } = await guardedQuery.select("*").maybeSingle();

  if (error) throw error;
  if (data) return data as ClaimIntentRow;

  const current = await getIntentById(intent.id, intent.user_address);
  if (!current) throw new Error(`Claim intent ${intent.id} disappeared during reconciliation`);
  return current;
}

export async function markIntentSubmitted(intent: ClaimIntentRow, txHash: string): Promise<ClaimIntentRow> {
  if (intent.status === "confirmed" || intent.status === "chain_confirmed") return intent;
  return updateIntentIfCurrent(intent, { status: "submitted", tx_hash: txHash, last_error: null });
}

// ── Finalizers (all-quests-self-claim-spec.md §7) ───────────────────────────
// Finalizers accept only the stored, frozen intent — never client data — and
// must be safe to run repeatedly. Only daily_engagement is implemented so
// far (every family in the current rollout phase uses it); other kinds fail
// closed rather than silently no-op.

async function upsertDailyEngagement(opts: {
  userAddress: string;
  questId: string;
  claimDate: string;
  pointsAwarded: number;
  source: "onchain" | "onchain_reconciled";
  txHash: string | null;
}) {
  const { error } = await supabase
    .from("daily_engagements")
    .upsert(
      {
        user_address: opts.userAddress.toLowerCase(),
        quest_id: opts.questId,
        claimed_at: opts.claimDate,
        points_awarded: opts.pointsAwarded,
        source: opts.source,
        tx_hash: opts.txHash,
      },
      { onConflict: "user_address,quest_id,claimed_at", ignoreDuplicates: true },
    );
  if (error && !isDuplicateError(error)) throw error;
}

async function runFinalizer(intent: ClaimIntentRow, source: "onchain" | "onchain_reconciled"): Promise<void> {
  switch (intent.finalizer_kind) {
    case "daily_engagement": {
      const payload = intent.finalizer_payload as { questId?: string; claimDate?: string };
      await upsertDailyEngagement({
        userAddress: intent.user_address,
        questId: payload.questId ?? intent.quest_id,
        claimDate: payload.claimDate ?? intent.scope_key,
        pointsAwarded: intent.points_awarded,
        source,
        txHash: intent.tx_hash,
      });
      return;
    }
    case "streak_engagement": {
      // Atomic RPC (supabase/migrations/076_streak_finalizer.sql) — replaces
      // helpers/streaks.ts's racy read-then-update for the self-claim path
      // (all-quests-self-claim-spec.md §7). Advances the streak AND records
      // the engagement in one transactional call, only after on-chain
      // confirmation — never at voucher issuance.
      const payload = intent.finalizer_payload as {
        questId?: string;
        scope: "daily" | "weekly";
        scopeKey?: string;
        claimedAt?: string;
      };
      const questId = payload.questId ?? intent.quest_id;
      const scopeKey = payload.scopeKey ?? intent.scope_key;
      const claimedAt = payload.claimedAt ?? scopeKey;
      const previousScopeKey = previousScopeKeyFor(payload.scope, scopeKey);

      const { error } = await supabase.rpc("advance_streak_and_engage", {
        p_user_address: intent.user_address.toLowerCase(),
        p_quest_id: questId,
        p_scope: payload.scope,
        p_scope_key: scopeKey,
        p_previous_scope_key: previousScopeKey,
        p_claimed_at: claimedAt,
        p_points_awarded: intent.points_awarded,
        p_source: source,
        p_tx_hash: intent.tx_hash,
      });
      if (error) throw error;
      return;
    }
    default:
      throw new Error(`[dailyClaimIntents] Unknown finalizer kind: ${intent.finalizer_kind}`);
  }
}

/**
 * Runs the idempotent domain finalizer for an intent already sitting at
 * chain_confirmed, then advances it to confirmed. Safe to call repeatedly —
 * a finalizer failure leaves the intent at chain_confirmed (the mint is
 * already irreversible) so the next reconcile call retries just the
 * finalizer, without ever re-verifying the chain or risking another mint.
 */
async function runFinalizerAndConfirm(intent: ClaimIntentRow): Promise<ClaimIntentRow> {
  if (intent.status === "confirmed") return intent;
  // A CAS loss upstream can hand back a row that isn't actually chain-proven
  // yet (e.g. still "submitted") — never run the finalizer (pay out) for that.
  if (intent.status !== "chain_confirmed") return intent;

  const source: "onchain" | "onchain_reconciled" = intent.tx_hash ? "onchain" : "onchain_reconciled";
  await runFinalizer(intent, source);
  return updateIntent(intent.id, { status: "confirmed", confirmed_at: new Date().toISOString(), last_error: null });
}

async function finalizeConfirmed(
  intent: ClaimIntentRow,
  source: "onchain" | "onchain_reconciled",
  txHash: string | null,
): Promise<ClaimIntentRow> {
  const chainConfirmed = await updateIntentIfCurrent(intent, {
    status: "chain_confirmed",
    tx_hash: txHash,
    chain_confirmed_at: new Date().toISOString(),
    last_error: null,
  });
  if (chainConfirmed.status !== "chain_confirmed") {
    // Lost the CAS race — some concurrent call already moved this intent
    // further (or reset it). runFinalizerAndConfirm's tx_hash-based source
    // guess is a fine fallback here since we no longer know which of our two
    // callers actually won.
    return runFinalizerAndConfirm(chainConfirmed);
  }
  // We just verified the chain ourselves — use the caller's precise source
  // label rather than runFinalizerAndConfirm's tx_hash-presence guess, which
  // would otherwise call every hash-bearing confirmation "onchain" even when
  // it was only reached via the claimed()-fallback path.
  await runFinalizer(chainConfirmed, source);
  return updateIntent(chainConfirmed.id, { status: "confirmed", confirmed_at: new Date().toISOString(), last_error: null });
}

async function resetToIssued(intent: ClaimIntentRow, error: string): Promise<ClaimIntentRow> {
  if (Number(intent.deadline) < Math.floor(Date.now() / 1000)) {
    return updateIntentIfCurrent(intent, { status: "expired", tx_hash: null, last_error: error });
  }
  return updateIntentIfCurrent(intent, { status: "issued", tx_hash: null, last_error: error });
}

// How long a "submitted" intent may sit with no receipt before it's treated
// as dropped rather than merely slow to mine. Matches the operational alert
// threshold in docs/daily-checkin-self-claim-spec.md §10 ("submitted intents
// stale for more than ten minutes") — without this, a transaction that never
// lands (replaced, underpriced, dropped from the mempool) leaves the wallet
// permanently unable to claim that scope.
const STALE_SUBMITTED_MS = Number(process.env.DAILY_CLAIM_STALE_SUBMITTED_MS ?? String(10 * 60 * 1000));

/**
 * Reads DailyQuestClaimer.claimed(user, claimNonce) directly (the ABI's
 * parameter is still named `dayNonce` — see lib/dailyQuestClaimer.ts). Used
 * both as the voucher route's step-6 gate and inside reconcileIntent when no
 * transaction hash has been recorded yet.
 */
export async function isClaimedOnchain(userAddress: string, claimNonce: bigint): Promise<boolean> {
  const claimerAddress = getClaimerAddress();
  const result = await celoClient.readContract({
    address: claimerAddress,
    abi: DAILY_QUEST_CLAIMER_ABI,
    functionName: "claimed",
    args: [userAddress as `0x${string}`, claimNonce],
  });
  return Boolean(result);
}

/**
 * Brings an intent's status in line with on-chain reality. Safe to call
 * repeatedly (idempotent) — from voucher issuance (stale nonterminal
 * intents), the confirm route, and the status-poll route alike, so closing
 * the browser after broadcast can never orphan a successful claim.
 */
export async function reconcileIntent(
  intent: ClaimIntentRow,
  opts: { incomingTxHash?: string } = {},
): Promise<ClaimIntentRow> {
  if (intent.status === "confirmed") return intent;
  // The chain proof already exists — no RPC call needed, just retry the
  // domain finalizer (all-quests-self-claim-spec.md §7).
  if (intent.status === "chain_confirmed") return runFinalizerAndConfirm(intent);

  const claimerAddress = getClaimerAddress();
  const hash = opts.incomingTxHash ?? intent.tx_hash ?? null;

  if (hash) {
    let receipt;
    try {
      receipt = await celoClient.getTransactionReceipt({ hash: hash as `0x${string}` });
    } catch {
      // Not yet mined (or not found). If this is the first time we've seen
      // this hash, start the submitted clock; otherwise check whether it's
      // been stuck long enough to treat as dropped rather than pending.
      if (intent.status !== "submitted" || intent.tx_hash !== hash) {
        return markIntentSubmitted(intent, hash);
      }
      const submittedAtMs = new Date(intent.updated_at).getTime();
      if (Number.isFinite(submittedAtMs) && Date.now() - submittedAtMs > STALE_SUBMITTED_MS) {
        // Directly ask the contract before giving up — a receipt lookup can
        // fail even for a mined tx on a lagging RPC node, and on-chain state
        // is still the mint authority (decision 4). Only ever reset on a
        // *successful* claimed()=false — an RPC/transport failure here must
        // not be coerced into "definitely not claimed", or an RPC outage
        // would invite the user to pay gas again for a claim that already
        // succeeded (or is merely still pending).
        let claimed: boolean;
        try {
          claimed = await isClaimedOnchain(intent.user_address, BigInt(intent.claim_nonce));
        } catch (e) {
          console.error("[dailyClaimIntents] claimed() check failed while evaluating staleness; leaving submitted", e);
          return intent;
        }
        if (claimed) return finalizeConfirmed(intent, "onchain_reconciled", hash);
        return resetToIssued(intent, "Transaction was not found on-chain after several minutes and was treated as dropped.");
      }
      return intent;
    }

    if (receipt.status !== "success") {
      return resetToIssued(intent, "Transaction reverted on-chain.");
    }

    if (receipt.to?.toLowerCase() !== claimerAddress.toLowerCase()) {
      return resetToIssued(intent, "Transaction destination did not match the claimer contract.");
    }
    if (receipt.from.toLowerCase() !== intent.user_address.toLowerCase()) {
      return resetToIssued(intent, "Transaction sender did not match the authenticated wallet.");
    }

    let matched = false;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== claimerAddress.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: DAILY_QUEST_CLAIMER_ABI,
          eventName: "QuestClaimed",
          data: log.data,
          topics: log.topics,
        });
        const args = decoded.args as unknown as { user: string; dayNonce: bigint; amount: bigint };
        if (
          args.user.toLowerCase() === intent.user_address.toLowerCase() &&
          args.dayNonce === BigInt(intent.claim_nonce) &&
          args.amount === BigInt(intent.amount_wei)
        ) {
          matched = true;
          break;
        }
      } catch {
        // Unrelated log on the same contract address — ignore.
      }
    }

    if (!matched) {
      return resetToIssued(intent, "Transaction did not emit a matching QuestClaimed event.");
    }

    // Receipt is already mined onto the canonical chain the RPC reports —
    // treat that as satisfying the "at least one confirmation" requirement.
    return finalizeConfirmed(intent, "onchain", hash);
  }

  // No hash recorded yet — fall back to the contract's own claimed() state,
  // which can only be true if mint() already succeeded (decision 4).
  const claimed = await isClaimedOnchain(intent.user_address, BigInt(intent.claim_nonce));
  if (claimed) {
    return finalizeConfirmed(intent, "onchain_reconciled", null);
  }

  if (Number(intent.deadline) < Math.floor(Date.now() / 1000)) {
    return updateIntentIfCurrent(intent, { status: "expired" });
  }

  return intent;
}

/**
 * Step 6 of the voucher route: the contract already shows this wallet/scope
 * as claimed, but an intent row may or may not still reflect that (e.g. the
 * intents table was cleared, or reconciliation raced). Idempotently brings
 * both daily_quest_claim_intents and the domain finalizer up to date without
 * ever recomputing the reward if a frozen intent already exists.
 */
export async function reconcileAlreadyClaimedOnchain(opts: {
  userAddress: string;
  questId: string;
  claimDate: string;
  dayNonce: bigint;
  deadline: bigint;
  fallbackPoints: number;
}): Promise<void> {
  const existing = await getIntentForDay(opts.userAddress, opts.questId, opts.claimDate);

  if (existing) {
    if (existing.status !== "confirmed") {
      await reconcileIntent(existing);
    }
    return;
  }

  // No intent row at all — extremely unlikely (claim() requires our own
  // voucher signature) but reconcile defensively with the current base
  // reward rather than leaving the finalizer out of sync.
  const created = await createIntent({
    userAddress: opts.userAddress,
    questId: opts.questId,
    claimDate: opts.claimDate,
    dayNonce: opts.dayNonce,
    deadline: opts.deadline,
    basePoints: opts.fallbackPoints,
    awardedPoints: opts.fallbackPoints,
    amountWei: BigInt(opts.fallbackPoints) * 10n ** 18n,
    vaultBoost: { applied: false, multiplier: 1, minBalanceUsdt: 0 },
  });
  if (created.status !== "confirmed") {
    await finalizeConfirmed(created, "onchain_reconciled", null);
  }
}

// How many prior scopes back to look for a wallet's own dangling
// (nonterminal) intents. reconcileIntent is only ever invoked for the
// *current* scope by the confirm/claim-status routes and by voucher
// issuance's own on-chain check — none of those run again for a *previous*
// scope once it rolls over, so a claim broadcast right before a scope
// boundary, followed by the browser closing before confirmation, would
// otherwise sit unreconciled forever (in-memory intentId/txHash are lost,
// and nothing else ever asks about that scope's intent again). See
// docs/daily-checkin-self-claim-spec.md §6's browser-close guarantee and the
// acceptance criterion that it must survive a return on a later day, not
// just later the same day.
const SWEEP_LOOKBACK_DAYS = Number(process.env.DAILY_CLAIM_SWEEP_LOOKBACK_DAYS ?? "3");

/**
 * Reconciles any of this wallet's own non-terminal intents for `questId`
 * from the last `SWEEP_LOOKBACK_DAYS` days *before* `beforeClaimDate`
 * (today is handled by the caller's own explicit flow and is deliberately
 * excluded here). Runs whenever the wallet next requests a voucher — i.e.
 * the next time it naturally interacts with the quest card — so a claim
 * that actually succeeded (or definitively reverted) on a prior day still
 * lands in its finalizer instead of being silently lost to a closed browser.
 * Best-effort: failures are logged, never thrown, so a sweep glitch can
 * never block today's claim.
 *
 * Scoped by claim_date (not the generic scope_key) because it compares
 * calendar dates — fine for every current caller (all daily-scoped
 * families); a family with weekly/lifetime scope needs its own sweep query
 * shape and isn't wired into this helper.
 */
export async function sweepStaleClaimIntents(opts: {
  userAddress: string;
  questId: string;
  beforeClaimDate: string;
}): Promise<void> {
  try {
    const cutoffMs = new Date(`${opts.beforeClaimDate}T00:00:00.000Z`).getTime() - SWEEP_LOOKBACK_DAYS * 86400_000;
    const cutoffDate = new Date(cutoffMs).toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from("daily_quest_claim_intents")
      .select("*")
      .eq("user_address", opts.userAddress.toLowerCase())
      .eq("quest_id", opts.questId)
      .in("status", ["issued", "submitted", "chain_confirmed"])
      .gte("claim_date", cutoffDate)
      .lt("claim_date", opts.beforeClaimDate)
      .limit(SWEEP_LOOKBACK_DAYS);

    if (error) {
      console.error("[dailyClaimIntents] sweep query failed", error.message);
      return;
    }
    for (const row of (data ?? []) as ClaimIntentRow[]) {
      await reconcileIntent(row).catch((e) =>
        console.error("[dailyClaimIntents] sweep reconcile failed for intent", row.id, e),
      );
    }
  } catch (e) {
    console.error("[dailyClaimIntents] sweep failed", e);
  }
}

/**
 * Extends an intent's signed-voucher deadline and returns it to "issued",
 * keeping the same id/nonce/amount/finalizer (all-quests-self-claim-spec.md
 * §3). Only ever called by the engine for adapters with
 * `canRefreshDeadline: true` — an instance/lifetime-scoped claim opportunity
 * does not actually close just because its signature's short lifetime did.
 */
export async function refreshIntentDeadline(intent: ClaimIntentRow, newDeadline: bigint): Promise<ClaimIntentRow> {
  if (intent.status === "confirmed" || intent.status === "chain_confirmed") return intent;
  return updateIntent(intent.id, {
    status: "issued",
    deadline: newDeadline.toString(),
    tx_hash: null,
    last_error: null,
  });
}
