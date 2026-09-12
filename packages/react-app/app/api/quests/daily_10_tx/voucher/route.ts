// app/api/quests/daily_10_tx/voucher/route.ts
//
// POST — issues a self-claim voucher for the 10-outgoing-transfers quest
// (docs/all-quests-self-claim-spec.md §5.4). Thin wrapper over the generic
// engine; eligibility lives in daily10TxAdapter.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { daily10TxAdapter } from "@/lib/server/adapters/dailyTransferCountAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(daily10TxAdapter, req);
}
