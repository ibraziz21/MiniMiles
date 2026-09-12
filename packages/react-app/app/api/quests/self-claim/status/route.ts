// app/api/quests/self-claim/status/route.ts
//
// GET /api/quests/self-claim/status?intentId=<uuid>&txHash=<optional> —
// generic, family-agnostic claim status/reconciliation
// (docs/all-quests-self-claim-spec.md §5.4).

import { getQuestClaimStatus } from "@/lib/server/questClaimEngine";

export async function GET(req: Request) {
  return getQuestClaimStatus(req);
}
