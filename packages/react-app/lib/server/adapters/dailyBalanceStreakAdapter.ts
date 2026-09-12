// lib/server/adapters/dailyBalanceStreakAdapter.ts
//
// Same eligibility rule as the legacy app/api/streaks/balances/route.ts: a
// combined stable-wallet balance of at least the tier's threshold, once per
// UTC day. Unlike the legacy route, questId -> tier/minUsd/points comes
// entirely from lib/streakRegistry.ts's fixed table — the tier is never
// taken from client input (docs/all-quests-self-claim-spec.md §5.5).

import { userStableWalletBalanceAtLeastUsd } from "@/helpers/walletStableBalance";
import { computeGenericClaimNonce, deadlineForScope, getUtcDateKey } from "@/lib/dailyQuestClaimer";
import { legacyDailyIdempotencyKey } from "@/lib/server/legacyMintJobGuard";
import { BALANCE_STREAK_QUEST_IDS, getBalanceStreakConfigByQuestId, type BalanceStreakTier } from "@/lib/streakRegistry";
import type { QuestClaimAdapter } from "@/lib/server/questClaimAdapters";

function makeBalanceStreakAdapter(tier: BalanceStreakTier): QuestClaimAdapter {
  const questId = BALANCE_STREAK_QUEST_IDS[tier];
  const config = getBalanceStreakConfigByQuestId(questId);
  if (!config) throw new Error(`[dailyBalanceStreakAdapter] Unknown tier: ${tier}`);

  return {
    family: `daily_balance_streak_${tier}`,

    async resolveIdentity() {
      const scopeKey = getUtcDateKey();
      return {
        questId,
        scopeKey,
        claimNonce: computeGenericClaimNonce(questId, scopeKey),
        deadline: deadlineForScope("daily", scopeKey),
      };
    },

    async verifyEligibility(session, identity) {
      const ok = await userStableWalletBalanceAtLeastUsd(session.walletAddress, config.minUsd);
      if (!ok) {
        return {
          ok: false,
          status: 200,
          code: "condition-failed",
          message: `Need at least $${config.minUsd} in your wallet (cUSD/USDT/other stables)`,
        };
      }
      return {
        ok: true,
        result: {
          basePoints: config.points,
          finalizerKind: "streak_engagement",
          finalizerPayload: {
            questId,
            scope: "daily",
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
}

export const dailyBalanceStreak10Adapter = makeBalanceStreakAdapter("10");
export const dailyBalanceStreak30Adapter = makeBalanceStreakAdapter("30");
export const dailyBalanceStreak100Adapter = makeBalanceStreakAdapter("100");
