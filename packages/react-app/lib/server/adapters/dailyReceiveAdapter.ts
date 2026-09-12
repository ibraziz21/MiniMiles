// lib/server/adapters/dailyReceiveAdapter.ts
//
// Same eligibility rule as the legacy app/api/quests/daily_receive/route.ts:
// at least one incoming transfer >= $1 in the trailing 24h.

import { userReceivedAtLeast1DollarIn24Hrs } from "@/helpers/graphQuestTransfer";
import { getQuest } from "@/lib/questRegistry";
import { makeDailyEngagementAdapter } from "@/lib/server/adapters/dailyEngagementAdapterFactory";

export const dailyReceiveAdapter = makeDailyEngagementAdapter({
  family: "daily_receive",
  loadQuest: () => getQuest("daily_receive"),
  async checkEligibility(session) {
    if (!(await userReceivedAtLeast1DollarIn24Hrs(session.walletAddress))) {
      return { ok: false, status: 200, message: "No incoming transfer ≥ $1 in the last 24 h" };
    }
    return { ok: true };
  },
});
