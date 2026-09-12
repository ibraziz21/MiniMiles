// lib/server/questClaimEngine.ts
//
// Generic self-claim voucher issuance/confirmation/status engine
// (docs/all-quests-self-claim-spec.md §5.3, §5.4), generalized from the
// working daily check-in implementation. Every claim family's thin voucher
// route calls issueQuestVoucher(adapter, req); confirm/status/pending are
// fully family-agnostic already (an intent is looked up by id or by
// wallet+quest+scope, never by family-specific logic) so there is exactly
// one implementation of each, called by both the daily-specific compatibility
// routes and the generic /api/quests/self-claim/* routes.

import { requireSession, logSessionAge } from "@/lib/auth";
import { validateDailyClaimConfig } from "@/lib/server/dailyClaimConfig";
import { signDailyClaimVoucher } from "@/lib/server/dailyClaimSigner";
import { checkDailyVoucherRateLimit, getClientIp } from "@/lib/server/dailyVoucherRateLimit";
import { isSelfClaimEnabledForWallet } from "@/lib/server/dailySelfClaimMode";
import { computeQuestReward } from "@/lib/server/questReward";
import { checkLegacyMintJobConflict } from "@/lib/server/legacyMintJobGuard";
import type { QuestClaimAdapter, SelfClaimSession } from "@/lib/server/questClaimAdapters";
import { deadlineForScope, pointsToAmountWei } from "@/lib/dailyQuestClaimer";
import {
  createGenericIntent,
  getIntentById,
  getIntentForScope,
  isClaimedOnchain,
  markIntentSubmitted,
  reconcileIntent,
  refreshIntentDeadline,
  sweepStaleClaimIntents,
  getPendingIntentsForWallet,
  type ClaimIntentRow,
} from "@/lib/server/dailyClaimIntents";

// Absolute ceiling on a single claim's award (all-quests-self-claim-spec.md
// §11) — the deployed contract has no pause switch or amount cap, so this is
// the last line of defense against a signing-key or config bug producing an
// outsized mint. Shared across every family; a family needing a different
// cap can layer a tighter one inside its own adapter.
const MAX_CLAIM_POINTS = Number(process.env.DAILY_CLAIM_MAX_POINTS ?? "500");

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status });
}

function toSelfClaimSession(session: { walletAddress: string; issuedAt: number; authProvider?: string }): SelfClaimSession {
  return {
    walletAddress: session.walletAddress.toLowerCase(),
    issuedAt: session.issuedAt,
    authProvider: session.authProvider as SelfClaimSession["authProvider"],
  };
}

function intentResponseFields(intent: ClaimIntentRow, adapter: QuestClaimAdapter) {
  return {
    delivery: "self-claim" as const,
    intentId: intent.id,
    family: adapter.family,
    questId: intent.quest_id,
    scopeKey: intent.scope_key,
  };
}

// ── Voucher issuance (all-quests-self-claim-spec.md §5.3) ───────────────────

export async function issueQuestVoucher(adapter: QuestClaimAdapter, req: Request): Promise<Response> {
  try {
    const rawSession = await requireSession();
    if (!rawSession) {
      return json(401, { success: false, code: "auth-required", message: "Authentication required" });
    }

    if (!isSelfClaimEnabledForWallet(adapter.family, rawSession.walletAddress)) {
      return json(403, {
        success: false,
        code: "self-claim-disabled",
        message: "Self-claim is not enabled for this wallet yet.",
      });
    }

    const session = toSelfClaimSession(rawSession);
    const addr = session.walletAddress;
    logSessionAge(`quests/${adapter.family}/voucher`, addr, session.issuedAt);

    const rateLimit = checkDailyVoucherRateLimit(getClientIp(req), addr);
    if (!rateLimit.ok) {
      return json(429, { success: false, code: "rate-limited", message: rateLimit.reason });
    }

    const configCheck = await validateDailyClaimConfig();
    if (!configCheck.ok) {
      console.error(`[${adapter.family}-voucher] config invalid:`, configCheck.reason);
      return json(503, {
        success: false,
        code: "signer-not-configured",
        message: "Claim service is temporarily unavailable. Please try again shortly.",
      });
    }
    const claimerAddress = configCheck.claimerAddress;

    const identity = await adapter.resolveIdentity(session);

    // Reconcile any of this wallet's own dangling intents for this quest from
    // prior scopes before touching the current one (§5.3 step 5). Best-effort
    // — sweepStaleClaimIntents never throws.
    await sweepStaleClaimIntents({
      userAddress: addr,
      questId: identity.questId,
      beforeClaimDate: identity.scopeKey,
    });

    // On-chain state is the mint authority — check first, regardless of what
    // our own intent row currently says. This also protects a scope for
    // which no intent was ever created (e.g. the table was cleared).
    let alreadyClaimed: boolean;
    try {
      alreadyClaimed = await isClaimedOnchain(addr, identity.claimNonce);
    } catch (e) {
      console.error(`[${adapter.family}-voucher] RPC error checking claimed():`, e);
      return json(503, { success: false, code: "chain-unavailable", message: "Could not reach Celo. Please try again." });
    }

    if (alreadyClaimed) {
      await reconcileClaimedNonceDefensively(adapter, identity, addr).catch((e) =>
        console.error(`[${adapter.family}-voucher] reconcile-already-claimed failed:`, e),
      );
      return json(200, { success: false, code: "already", message: "Already claimed" });
    }

    let intent = await getIntentForScope(addr, identity.questId, identity.scopeKey);

    if (!intent) {
      // No intent yet — refuse to create one while a legacy sponsored job for
      // the exact same completion may still mint (§5.3 step 8, goal 6).
      if (adapter.legacyIdempotencyKey) {
        const key = adapter.legacyIdempotencyKey(identity, addr);
        const legacy = await checkLegacyMintJobConflict(key);
        if (legacy.conflict && legacy.status === "already") {
          return json(200, { success: false, code: "already", message: "Already claimed" });
        }
        if (legacy.conflict && legacy.status === "processing") {
          return json(200, {
            success: false,
            code: "processing",
            message: "A previous claim for this reward is already being processed. Please check back shortly.",
          });
        }
      }

      const eligibility = await adapter.verifyEligibility(session, identity);
      if (!eligibility.ok) {
        return json(eligibility.status, {
          success: false,
          code: eligibility.code,
          message: eligibility.message,
        });
      }

      const reward = await computeQuestReward(addr, eligibility.result.basePoints);
      const awardedPoints = Math.min(reward.awardedPoints, MAX_CLAIM_POINTS);

      intent = await createGenericIntent({
        userAddress: addr,
        questId: identity.questId,
        scopeKey: identity.scopeKey,
        claimNonce: identity.claimNonce,
        claimFamily: adapter.family,
        deadline: identity.deadline,
        basePoints: reward.basePoints,
        awardedPoints,
        amountWei: pointsToAmountWei(awardedPoints),
        vaultBoost: reward.vaultBoost,
        finalizerKind: eligibility.result.finalizerKind,
        finalizerPayload: eligibility.result.finalizerPayload,
        eligibilityRef: eligibility.result.eligibilityRef,
      });
    } else if (intent.status === "confirmed") {
      return json(200, { success: false, code: "already", message: "Already claimed" });
    } else if (intent.status === "submitted" || intent.status === "chain_confirmed") {
      intent = await reconcileIntent(intent);
      if (intent.status === "confirmed") {
        return json(200, { success: false, code: "already", message: "Already claimed" });
      }
      if (intent.status === "submitted" || intent.status === "chain_confirmed") {
        return json(200, {
          success: false,
          status: "submitted",
          code: "submitted",
          ...intentResponseFields(intent, adapter),
          points: intent.points_awarded,
          txHash: intent.tx_hash,
          message: "Your previous claim transaction is still confirming.",
        });
      }
      // Reverted/invalid — intent is back to "issued", fall through and reuse it.
    } else if (intent.status === "expired") {
      if (!adapter.canRefreshDeadline) {
        return json(200, {
          success: false,
          code: "expired",
          message: "This claim's window has closed. Please try again.",
        });
      }
      // Instance/lifetime scope — the claim opportunity itself hasn't closed,
      // only the signature's short lifetime did. Same intent/nonce/amount,
      // just a fresh deadline (§3).
      intent = await refreshIntentDeadline(intent, deadlineForScope("instance", intent.scope_key));
    }

    // A daily/weekly voucher can never reach here with a lapsed deadline (its
    // scope and its deadline close together), but a reused "issued"
    // instance/lifetime intent might — refresh proactively rather than
    // signing a voucher that would revert on-chain as Expired.
    if (adapter.canRefreshDeadline && Number(intent.deadline) < Math.floor(Date.now() / 1000)) {
      intent = await refreshIntentDeadline(intent, deadlineForScope("instance", intent.scope_key));
    }

    const signature = await signDailyClaimVoucher({
      user: addr as `0x${string}`,
      amount: BigInt(intent.amount_wei),
      dayNonce: BigInt(intent.claim_nonce),
      deadline: BigInt(intent.deadline),
      contractAddress: claimerAddress,
    });

    return json(200, {
      success: true,
      status: "issued",
      ...intentResponseFields(intent, adapter),
      contractAddress: claimerAddress,
      amount: intent.amount_wei,
      points: intent.points_awarded,
      basePoints: intent.base_points,
      vaultBoost: intent.vault_boost,
      dayNonce: intent.claim_nonce,
      deadline: intent.deadline,
      signature,
    });
  } catch (err: any) {
    console.error(`[${adapter.family}-voucher] unexpected error`, err);
    return json(500, { success: false, message: err?.message ?? "Error" });
  }
}

/**
 * Defensive reconciliation for "claimed()=true" with no matching intent —
 * extremely unlikely (claim() requires our own voucher signature) but
 * possible if the intents table was cleared. Falls back to the adapter's own
 * eligibility base points, since the true frozen reward can no longer be
 * recovered once the intent row is gone.
 */
async function reconcileClaimedNonceDefensively(
  adapter: QuestClaimAdapter,
  identity: Awaited<ReturnType<QuestClaimAdapter["resolveIdentity"]>>,
  userAddress: string,
): Promise<void> {
  const existing = await getIntentForScope(userAddress, identity.questId, identity.scopeKey);
  if (existing) {
    if (existing.status !== "confirmed") await reconcileIntent(existing);
    return;
  }
  console.error(
    `[${adapter.family}-voucher] claimed()=true with no matching intent for`,
    userAddress,
    identity.questId,
    identity.scopeKey,
  );
}

// ── Confirmation and status (fully family-agnostic) ─────────────────────────

const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;

export async function confirmQuestClaim(req: Request): Promise<Response> {
  try {
    const session = await requireSession();
    if (!session) {
      return json(401, { success: false, code: "auth-required", message: "Authentication required" });
    }
    const addr = session.walletAddress.toLowerCase();

    let body: { txHash?: unknown; intentId?: unknown };
    try {
      body = await req.json();
    } catch {
      return json(400, { success: false, message: "Invalid JSON body" });
    }

    const txHash = body?.txHash;
    if (typeof txHash !== "string" || !TX_HASH_RE.test(txHash)) {
      return json(400, { success: false, message: "txHash must be a 0x-prefixed 32-byte transaction hash" });
    }
    if (body?.intentId !== undefined && typeof body.intentId !== "string") {
      return json(400, { success: false, message: "intentId must be a UUID string" });
    }
    const intentId = typeof body?.intentId === "string" ? body.intentId : null;

    let intent: ClaimIntentRow | null;
    if (intentId !== null) {
      intent = await getIntentById(intentId, addr);
      if (!intent) {
        return json(404, { success: false, message: "No claim found for that id." });
      }
    } else {
      return json(400, { success: false, message: "intentId is required." });
    }

    if (intent.status !== "confirmed" && intent.status !== "chain_confirmed" && intent.tx_hash !== txHash) {
      intent = await markIntentSubmitted(intent, txHash);
    }

    intent = await reconcileIntent(intent, { incomingTxHash: txHash });

    if (intent.status === "confirmed") {
      return json(200, {
        success: true,
        status: "confirmed",
        intentId: intent.id,
        family: intent.claim_family,
        points: intent.points_awarded,
        txHash: intent.tx_hash,
      });
    }
    if (intent.status === "submitted" || intent.status === "chain_confirmed") {
      return json(200, { success: true, status: "submitted", intentId: intent.id, family: intent.claim_family });
    }

    return json(200, {
      success: false,
      status: intent.status,
      intentId: intent.id,
      family: intent.claim_family,
      code: "reverted",
      message: intent.last_error ?? "Transaction failed. You can try again.",
    });
  } catch (err: any) {
    console.error("[quest-self-claim-confirm] unexpected error", err);
    return json(500, { success: false, message: err?.message ?? "Error" });
  }
}

export async function getQuestClaimStatus(req: Request): Promise<Response> {
  try {
    const session = await requireSession();
    if (!session) {
      return json(401, { success: false, code: "auth-required", message: "Authentication required" });
    }
    const addr = session.walletAddress.toLowerCase();

    const url = new URL(req.url);
    const intentId = url.searchParams.get("intentId");
    const txHashHintRaw = url.searchParams.get("txHash");
    if (txHashHintRaw !== null && !TX_HASH_RE.test(txHashHintRaw)) {
      return json(400, { success: false, message: "txHash must be a 0x-prefixed 32-byte transaction hash" });
    }

    if (!intentId) {
      return json(400, { success: false, message: "intentId is required." });
    }

    const intent = await getIntentById(intentId, addr);
    if (!intent) {
      return json(200, { success: true, status: "issued", exists: false });
    }

    const reconciled = await reconcileIntent(intent, txHashHintRaw ? { incomingTxHash: txHashHintRaw } : undefined);

    return json(200, {
      success: true,
      status: reconciled.status,
      exists: true,
      intentId: reconciled.id,
      family: reconciled.claim_family,
      points: reconciled.points_awarded,
      txHash: reconciled.tx_hash,
      lastError: reconciled.last_error,
    });
  } catch (err: any) {
    console.error("[quest-self-claim-status] unexpected error", err);
    return json(500, { success: false, message: err?.message ?? "Error" });
  }
}

/** Wallet-scoped bounded list of nonterminal intents, for cross-device recovery (§5.4 /pending). */
export async function getPendingQuestClaims(_req: Request): Promise<Response> {
  try {
    const session = await requireSession();
    if (!session) {
      return json(401, { success: false, code: "auth-required", message: "Authentication required" });
    }
    const addr = session.walletAddress.toLowerCase();

    const pending = await getPendingIntentsForWallet(addr);
    return json(200, {
      success: true,
      intents: pending.map((intent) => ({
        intentId: intent.id,
        family: intent.claim_family,
        questId: intent.quest_id,
        scopeKey: intent.scope_key,
        status: intent.status,
        points: intent.points_awarded,
        txHash: intent.tx_hash,
        deadline: intent.deadline,
      })),
    });
  } catch (err: any) {
    console.error("[quest-self-claim-pending] unexpected error", err);
    return json(500, { success: false, message: err?.message ?? "Error" });
  }
}
