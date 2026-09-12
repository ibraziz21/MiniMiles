// app/api/quests/daily/voucher/route.ts
//
// POST /api/quests/daily/voucher — issues a server-signed EIP-712 voucher
// for the daily check-in quest that the user's own wallet submits on-chain
// (docs/daily-checkin-self-claim-spec.md §4). Accepts no body fields: the
// claimant, quest, date and reward are all resolved server-side from the
// session.
//
// Thin wrapper over the generic self-claim engine
// (docs/all-quests-self-claim-spec.md §5.1, §8.1) — all family-specific
// eligibility logic lives in dailyCheckinAdapter.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { dailyCheckinAdapter } from "@/lib/server/adapters/dailyCheckinAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(dailyCheckinAdapter, req);
}
