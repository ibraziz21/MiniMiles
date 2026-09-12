// app/api/quests/seven_day_streak/voucher/route.ts
//
// POST — issues a self-claim voucher for the 7-day send-streak reward
// (docs/all-quests-self-claim-spec.md §5.4, §8.1).

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { sevenDaySendStreakAdapter } from "@/lib/server/adapters/sevenDaySendStreakAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(sevenDaySendStreakAdapter, req);
}
