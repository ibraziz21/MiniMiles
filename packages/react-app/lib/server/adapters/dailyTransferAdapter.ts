// lib/server/adapters/dailyTransferAdapter.ts
//
// Same eligibility rule as the legacy app/api/quests/daily_transfer/route.ts:
// at least one outgoing transfer >= $1 in the trailing 24h.

import { userSentAtLeast1DollarIn24Hrs } from "@/helpers/graphQuestTransfer";
import { getQuest } from "@/lib/questRegistry";
import { makeDailyEngagementAdapter } from "@/lib/server/adapters/dailyEngagementAdapterFactory";

export const dailyTransferAdapter = makeDailyEngagementAdapter({
  family: "daily_transfer",
  loadQuest: () => getQuest("daily_transfer"),
  async checkEligibility(session) {
    if (!(await userSentAtLeast1DollarIn24Hrs(session.walletAddress))) {
      return { ok: false, status: 200, message: "No outgoing transfer ≥ $1 in the last 24 h" };
    }
    return { ok: true };
  },
});
