// app/api/streaks/balances/voucher/route.ts
//
// POST — issues a self-claim voucher for one of the three wallet-balance
// streak tiers (docs/all-quests-self-claim-spec.md §5.4). The client selects
// among a fixed server allowlist by questId (spec §5.2) — tier, minUsd and
// points are never taken from the client, only looked up from
// lib/streakRegistry.ts's fixed table. An unregistered questId returns 400.

import { issueQuestVoucher } from "@/lib/server/questClaimEngine";
import {
  dailyBalanceStreak10Adapter,
  dailyBalanceStreak30Adapter,
  dailyBalanceStreak100Adapter,
} from "@/lib/server/adapters/dailyBalanceStreakAdapter";
import { getBalanceStreakConfigByQuestId, type BalanceStreakTier } from "@/lib/streakRegistry";
import type { QuestClaimAdapter } from "@/lib/server/questClaimAdapters";

const ADAPTER_BY_TIER: Record<BalanceStreakTier, QuestClaimAdapter> = {
  "10": dailyBalanceStreak10Adapter,
  "30": dailyBalanceStreak30Adapter,
  "100": dailyBalanceStreak100Adapter,
};

export async function POST(req: Request) {
  let body: { questId?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const questId = typeof body?.questId === "string" ? body.questId : null;
  const config = questId ? getBalanceStreakConfigByQuestId(questId) : null;
  if (!config) {
    return Response.json({ success: false, message: "Unknown or missing questId" }, { status: 400 });
  }

  return issueQuestVoucher(ADAPTER_BY_TIER[config.tier], req);
}
