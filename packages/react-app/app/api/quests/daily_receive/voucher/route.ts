// app/api/quests/daily_receive/voucher/route.ts
//
// POST — issues a self-claim voucher for the daily-receive-$1 quest
// (docs/all-quests-self-claim-spec.md §5.4). Thin wrapper over the generic
// engine; eligibility lives in dailyReceiveAdapter.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { dailyReceiveAdapter } from "@/lib/server/adapters/dailyReceiveAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(dailyReceiveAdapter, req);
}
