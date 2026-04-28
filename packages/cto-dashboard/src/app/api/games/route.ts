import { NextResponse } from "next/server";
import {
  getGameSessionVolume, getGameScoreDistribution,
  getAntiFlagRates, getGameLeaderboard, getTodayGameStats,
} from "@/lib/db";
import { getDiceOnchainStats, getGameTreasuryMilesPool } from "@/lib/chain";

export const revalidate = 60;

export async function GET() {
  const [volume, scores, flags, rtLB, mfLB, todayStats, diceStats, treasury] =
    await Promise.allSettled([
      getGameSessionVolume(30),
      getGameScoreDistribution(),
      getAntiFlagRates(),
      getGameLeaderboard("rule_tap", 15),
      getGameLeaderboard("memory_flip", 15),
      getTodayGameStats(),
      getDiceOnchainStats(),
      getGameTreasuryMilesPool(),
    ]);

  function val<T>(r: PromiseSettledResult<T>, fallback: T): T {
    return r.status === "fulfilled" ? r.value : fallback;
  }

  return NextResponse.json({
    sessionVolume: val(volume, []),
    scoreDistribution: val(scores, { rule_tap: [], memory_flip: [] }),
    antiFlagRates: val(flags, []),
    leaderboards: {
      rule_tap: val(rtLB, []),
      memory_flip: val(mfLB, []),
    },
    today: val(todayStats, { total: 0, accepted: 0, rejected: 0, milesAwarded: 0, byType: {} }),
    dice: val(diceStats, { totalCreated: 0, totalResolved: 0, totalPayoutMiles: 0 }),
    treasuryPool: val(treasury, 0),
  });
}
