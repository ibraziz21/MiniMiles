// app/api/quests/self-claim/confirm/route.ts
//
// POST /api/quests/self-claim/confirm — generic, family-agnostic claim
// confirmation (docs/all-quests-self-claim-spec.md §5.4). Body:
// { intentId, txHash }. Daily check-in's own /api/quests/daily/confirm
// remains a separate compatibility alias with its own date-based fallback
// for older clients that never received an intentId — this generic endpoint
// has no such fallback since every client calling it already has one.

import { confirmQuestClaim } from "@/lib/server/questClaimEngine";

export async function POST(req: Request) {
  return confirmQuestClaim(req);
}
