// app/api/streaks/topup/voucher/route.ts
//
// POST — issues a self-claim voucher for the weekly MiniPay top-up streak
// (docs/all-quests-self-claim-spec.md §5.4). No active UI entry point today
// (its daily-challenge.tsx card is commented out) — kept for backend
// completeness.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { weeklyTopupStreakAdapter } from "@/lib/server/adapters/weeklyTopupStreakAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(weeklyTopupStreakAdapter, req);
}
