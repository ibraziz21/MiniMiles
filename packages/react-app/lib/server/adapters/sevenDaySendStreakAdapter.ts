// lib/server/adapters/sevenDaySendStreakAdapter.ts
//
// Same eligibility rule as the legacy app/api/quests/seven_day_streak/route.ts:
// 7 consecutive days of the daily-send-$1 quest. Unlike every other Phase-2/3
// family, this one is instance-scoped, not daily/weekly
// (docs/all-quests-self-claim-spec.md §2, §8.1): the scope key identifies the
// earned streak *instance* (its own 7-day window, anchored to when the run
// first qualified — see lib/sevenDaySendStreak.ts's instanceStartDate/
// instanceEndDate) rather than "the day the user happened to press Claim".
// Using "today" here would let one completion be claimed repeatedly across
// different days via different nonces — see the spec's explicit warning.
//
// canRefreshDeadline is set because an instance claim's opportunity doesn't
// actually close when its short (15-minute) signed-voucher lifetime does —
// only the signature needs refreshing, not the underlying eligibility.

import { supabase } from "@/lib/supabaseClient";
import { computeGenericClaimNonce, deadlineForScope, getUtcDateKey } from "@/lib/dailyQuestClaimer";
import { buildSevenDaySendStreakStatus, SEVEN_DAY_STREAK_QUEST_ID } from "@/lib/sevenDaySendStreak";
import type { QuestClaimAdapter } from "@/lib/server/questClaimAdapters";

const SEVEN_DAY_STREAK_REWARD_POINTS = 200;

export const sevenDaySendStreakAdapter: QuestClaimAdapter = {
  family: "seven_day_send_streak",
  canRefreshDeadline: true,

  async resolveIdentity(session) {
    const status = await buildSevenDaySendStreakStatus(supabase, session.walletAddress);
    // Anchored to the earned instance's own window when one currently
    // qualifies; otherwise a throwaway placeholder — verifyEligibility
    // rejects before any intent is ever created from it, so an unclaimable
    // "today"-based key here is never actually persisted as a nonce.
    const scopeKey =
      status.instanceStartDate && status.instanceEndDate
        ? `streak:${status.instanceStartDate}:${status.instanceEndDate}`
        : getUtcDateKey();

    return {
      questId: SEVEN_DAY_STREAK_QUEST_ID,
      scopeKey,
      claimNonce: computeGenericClaimNonce(SEVEN_DAY_STREAK_QUEST_ID, scopeKey),
      deadline: deadlineForScope("instance", scopeKey),
    };
  },

  async verifyEligibility(session, identity) {
    const status = await buildSevenDaySendStreakStatus(supabase, session.walletAddress);

    if (status.rewardClaimed) {
      return { ok: false, status: 200, code: "already", message: "Already claimed" };
    }
    if (!status.claimable) {
      return {
        ok: false,
        status: 200,
        code: "condition-failed",
        message: "You need 7 days in a row of sending ≥ $1 to claim this.",
      };
    }

    return {
      ok: true,
      result: {
        basePoints: SEVEN_DAY_STREAK_REWARD_POINTS,
        finalizerKind: "daily_engagement",
        // Recorded under the day it's actually issued/confirmed, matching
        // the legacy route's existing history behavior — only the intent's
        // replay-nonce scope key uses the earned-instance identity, not this.
        finalizerPayload: { questId: identity.questId, claimDate: getUtcDateKey() },
      },
    };
  },

  // No legacyIdempotencyKey: the legacy route calls claimQueuedDailyReward
  // with scopeKey = today's date, so its idempotency key changes daily and
  // cannot conflict-check against this family's stable instance-based scope
  // key. A completed legacy claim is still caught by claimed()/existing
  // daily_engagements rows before eligibility is even checked (decision 4).
};
