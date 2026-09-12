// lib/server/adapters/weeklyTopupStreakAdapter.ts
//
// Same eligibility rule as the legacy app/api/streaks/topup/route.ts: a
// MiniPay top-up of at least $5 in the trailing 7 days, once per ISO week.
// No active UI entry point today (its daily-challenge.tsx card is
// commented out) — kept for backend completeness per
// docs/all-quests-self-claim-spec.md's scope table. Weekly-scoped, so it
// cannot reuse dailyEngagementAdapterFactory (which is daily-scope-only).

import { userToppedUpAtLeast5DollarsInLast7Days } from "@/helpers/graphTopupStreak";
import { computeGenericClaimNonce, deadlineForScope, getUtcIsoWeekKey } from "@/lib/dailyQuestClaimer";
import { legacyDailyIdempotencyKey } from "@/lib/server/legacyMintJobGuard";
import { TOPUP_STREAK_POINTS, TOPUP_STREAK_QUEST_ID } from "@/lib/streakRegistry";
import type { QuestClaimAdapter } from "@/lib/server/questClaimAdapters";

export const weeklyTopupStreakAdapter: QuestClaimAdapter = {
  family: "weekly_topup_streak",

  async resolveIdentity() {
    const scopeKey = getUtcIsoWeekKey();
    return {
      questId: TOPUP_STREAK_QUEST_ID,
      scopeKey,
      claimNonce: computeGenericClaimNonce(TOPUP_STREAK_QUEST_ID, scopeKey),
      deadline: deadlineForScope("weekly", scopeKey),
    };
  },

  async verifyEligibility(session, identity) {
    const ok = await userToppedUpAtLeast5DollarsInLast7Days(session.walletAddress);
    if (!ok) {
      return { ok: false, status: 200, message: "No MiniPay top-up ≥ $5 in the last 7 days" };
    }
    return {
      ok: true,
      result: {
        basePoints: TOPUP_STREAK_POINTS,
        finalizerKind: "streak_engagement",
        finalizerPayload: {
          questId: TOPUP_STREAK_QUEST_ID,
          scope: "weekly",
          scopeKey: identity.scopeKey,
          claimedAt: identity.scopeKey,
        },
      },
    };
  },

  legacyIdempotencyKey(identity, userAddress) {
    return legacyDailyIdempotencyKey(identity.questId, userAddress, identity.scopeKey);
  },
};
