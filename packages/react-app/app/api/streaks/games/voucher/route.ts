// app/api/streaks/games/voucher/route.ts
//
// POST — issues a self-claim voucher for the daily games-activity streak
// (docs/all-quests-self-claim-spec.md §5.4). No active UI entry point today
// — kept for backend completeness.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import { dailyGamesStreakAdapter } from "@/lib/server/adapters/dailyGamesStreakAdapter";

export async function POST(req: Request) {
  return issueQuestVoucher(dailyGamesStreakAdapter, req);
}
