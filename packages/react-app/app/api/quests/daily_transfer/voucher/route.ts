// app/api/quests/daily_transfer/voucher/route.ts
//
// POST — issues a self-claim voucher for the daily-send-$1 quest
// (docs/all-quests-self-claim-spec.md §5.4). Thin wrapper over the generic
// engine; eligibility lives in dailyTransferAdapter.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { dailyTransferAdapter } from "@/lib/server/adapters/dailyTransferAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(dailyTransferAdapter, req);
}
