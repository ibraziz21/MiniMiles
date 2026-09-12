// app/api/quests/daily_5_tx/voucher/route.ts
//
// POST — issues a self-claim voucher for the 5-outgoing-transfers quest
// (docs/all-quests-self-claim-spec.md §5.4). Thin wrapper over the generic
// engine; eligibility lives in daily5TxAdapter.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { daily5TxAdapter } from "@/lib/server/adapters/dailyTransferCountAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(daily5TxAdapter, req);
}
