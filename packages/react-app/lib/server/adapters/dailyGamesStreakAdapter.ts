// lib/server/adapters/dailyGamesStreakAdapter.ts
//
// Same eligibility rule as the legacy app/api/streaks/games/route.ts: at
// least one game played in the trailing 24h. No active UI entry point today
// (hooks/useStreakQuests.ts's useGamesStreakQuest is unused) — kept for
// backend completeness per docs/all-quests-self-claim-spec.md's scope table.

import { userPlayedAtLeastOneGameInLast24Hrs } from "@/helpers/graphGames";
import { getQuest } from "@/lib/questRegistry";
import { makeDailyEngagementAdapter } from "@/lib/server/adapters/dailyEngagementAdapterFactory";
import type { QuestClaimAdapter } from "@/lib/server/questClaimAdapters";

const baseAdapter = makeDailyEngagementAdapter({
  family: "daily_games_streak",
  loadQuest: () => getQuest("games_streak"),
  async checkEligibility(session) {
    const ok = await userPlayedAtLeastOneGameInLast24Hrs(session.walletAddress);
    if (!ok) {
      return { ok: false, status: 200, message: "No game activity in the last 24 hours" };
    }
    return { ok: true };
  },
});

// The legacy route's finalizer is streak_engagement (it calls
// claimStreakReward, which upserts the streaks table), not the factory's
// default daily_engagement — override just the finalizer kind/payload.
export const dailyGamesStreakAdapter: QuestClaimAdapter = {
  ...baseAdapter,
  async verifyEligibility(session, identity) {
    const result = await baseAdapter.verifyEligibility(session, identity);
    if (!result.ok) return result;
    return {
      ok: true,
      result: {
        ...result.result,
        finalizerKind: "streak_engagement",
        finalizerPayload: {
          questId: identity.questId,
          scope: "daily",
          scopeKey: identity.scopeKey,
          claimedAt: identity.scopeKey,
        },
      },
    };
  },
};
