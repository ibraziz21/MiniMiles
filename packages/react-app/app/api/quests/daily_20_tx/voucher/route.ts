// app/api/quests/daily_20_tx/voucher/route.ts
//
// POST — issues a self-claim voucher for the 20-outgoing-transfers quest
// (docs/all-quests-self-claim-spec.md §5.4). Thin wrapper over the generic
// engine; eligibility lives in daily20TxAdapter.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { daily20TxAdapter } from "@/lib/server/adapters/dailyTransferCountAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(daily20TxAdapter, req);
}
