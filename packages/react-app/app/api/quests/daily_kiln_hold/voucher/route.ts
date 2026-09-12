// app/api/quests/daily_kiln_hold/voucher/route.ts
//
// POST — issues a self-claim voucher for the Kiln daily-hold quest
// (docs/all-quests-self-claim-spec.md §5.4). Thin wrapper over the generic
// engine; eligibility lives in dailyKilnHoldAdapter.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { dailyKilnHoldAdapter } from "@/lib/server/adapters/dailyKilnHoldAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(dailyKilnHoldAdapter, req);
}
