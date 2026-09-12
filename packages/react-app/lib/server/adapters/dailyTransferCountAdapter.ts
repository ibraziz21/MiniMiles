// lib/server/adapters/dailyTransferCountAdapter.ts
//
// Shared shape for the three transfer-count quests (5/10/20 outgoing
// transfers in 24h) — the legacy app/api/quests/daily_5_tx, daily_10_tx and
// daily_20_tx routes are otherwise byte-for-byte identical aside from the
// threshold and registry key.

import { countOutgoingTransfersIn24H } from "@/helpers/graphQuestTransfer";
import { getQuest, type QuestConfig } from "@/lib/questRegistry";
import { makeDailyEngagementAdapter } from "@/lib/server/adapters/dailyEngagementAdapterFactory";

function makeTransferCountAdapter(opts: { family: string; threshold: number; loadQuest: () => QuestConfig }) {
  return makeDailyEngagementAdapter({
    family: opts.family,
    loadQuest: opts.loadQuest,
    async checkEligibility(session) {
      let txs: number;
      try {
        txs = await countOutgoingTransfersIn24H(session.walletAddress, opts.threshold);
      } catch (err) {
        console.error(`[${opts.family}-adapter] RPC transfer count failed:`, err);
        return {
          ok: false,
          status: 503,
          message: "Could not verify recent transfer activity. Please try again.",
        };
      }
      if (txs < opts.threshold) {
        return { ok: false, status: 200, message: `Only ${txs}/${opts.threshold} transfers in the last 24 h` };
      }
      return { ok: true };
    },
  });
}

export const daily5TxAdapter = makeTransferCountAdapter({
  family: "daily_5tx",
  threshold: 5,
  loadQuest: () => getQuest("daily_5tx"),
});

export const daily10TxAdapter = makeTransferCountAdapter({
  family: "daily_10tx",
  threshold: 10,
  loadQuest: () => getQuest("daily_10tx"),
});

export const daily20TxAdapter = makeTransferCountAdapter({
  family: "daily_20tx",
  threshold: 20,
  loadQuest: () => getQuest("daily_20tx"),
});
