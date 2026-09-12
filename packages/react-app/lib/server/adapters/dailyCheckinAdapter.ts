// lib/server/adapters/dailyCheckinAdapter.ts
//
// Daily check-in's QuestClaimAdapter (docs/all-quests-self-claim-spec.md
// §5.2, §8.1 — "Refactor working daily check-in onto the generic engine with
// no behavior change"). Every check here is exactly what
// app/api/quests/daily/route.ts (legacy) and the original voucher route
// already enforced: blacklist, then the MiniPay-exempt Celo activity gate.
// Still uses the legacy epoch-day claim nonce for backward compatibility —
// see lib/dailyQuestClaimer.ts's getUtcDayContext.

import { isBlacklisted } from "@/lib/blacklist";
import { getQuest } from "@/lib/questRegistry";
import { getCeloTxCount } from "@/lib/celoClient";
import { getUtcDayContext } from "@/lib/dailyQuestClaimer";
import type { QuestClaimAdapter } from "@/lib/server/questClaimAdapters";
import { legacyDailyIdempotencyKey } from "@/lib/server/legacyMintJobGuard";

const MIN_LIFETIME_TXS = Number(process.env.MIN_CELO_TX_COUNT ?? "3");

export const dailyCheckinAdapter: QuestClaimAdapter = {
  family: "daily_checkin",

  async resolveIdentity() {
    const { claimDate, dayNonce, deadline } = getUtcDayContext();
    const quest = getQuest("daily_checkin");
    return { questId: quest.questId, scopeKey: claimDate, claimNonce: dayNonce, deadline };
  },

  async verifyEligibility(session, identity) {
    if (await isBlacklisted(session.walletAddress, "quests/daily_checkin/voucher")) {
      return { ok: false, status: 403, code: "blacklisted", message: "Forbidden" };
    }

    // MiniPay sessions skip this so new custodial users can start with daily check-in.
    if (session.authProvider !== "minipay") {
      let txCount: number;
      try {
        txCount = await getCeloTxCount(session.walletAddress);
      } catch (e) {
        console.error("[daily-checkin-adapter] RPC error checking activity:", e);
        return { ok: false, status: 503, code: "chain-unavailable", message: "Could not verify wallet activity. Please try again." };
      }
      if (txCount < MIN_LIFETIME_TXS) {
        return { ok: false, status: 403, code: "insufficient-activity", message: "Do anything on Celo today to claim." };
      }
    }

    const quest = getQuest("daily_checkin");
    return {
      ok: true,
      result: {
        basePoints: quest.points,
        finalizerKind: "daily_engagement",
        finalizerPayload: { questId: quest.questId, claimDate: identity.scopeKey },
      },
    };
  },

  legacyIdempotencyKey(identity, userAddress) {
    return legacyDailyIdempotencyKey(identity.questId, userAddress, identity.scopeKey);
  },
};
