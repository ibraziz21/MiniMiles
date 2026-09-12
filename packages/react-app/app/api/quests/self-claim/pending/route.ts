// app/api/quests/self-claim/pending/route.ts
//
// GET /api/quests/self-claim/pending — the authenticated wallet's bounded
// nonterminal intents across every claim family, for cross-device/app
// recovery (docs/all-quests-self-claim-spec.md §5.4, §9).

import { getPendingQuestClaims } from "@/lib/server/questClaimEngine";

export async function GET(req: Request) {
  return getPendingQuestClaims(req);
}
