import { NextResponse } from "next/server";
import {
  getTotalUsers, getDAU, getTotalMilesMinted,
  getNewUsersLast30Days, getTodayGameStats,
} from "@/lib/db";
import {
  getMilesV2TotalSupply, getVaultOnchainTVL,
  getDiceOnchainStats, getGameTreasuryMilesPool,
} from "@/lib/chain";

export const revalidate = 60;

export async function GET() {
  const [
    totalUsers, dau, totalMilesDB, newUsers30d, todayGames,
    milesSupply, vaultTVL, diceStats, treasuryPool,
  ] = await Promise.allSettled([
    getTotalUsers(),
    getDAU(),
    getTotalMilesMinted(),
    getNewUsersLast30Days(),
    getTodayGameStats(),
    getMilesV2TotalSupply(),
    getVaultOnchainTVL(),
    getDiceOnchainStats(),
    getGameTreasuryMilesPool(),
  ]);

  function val<T>(r: PromiseSettledResult<T>, fallback: T): T {
    return r.status === "fulfilled" ? r.value : fallback;
  }

  const newUsersArr = val(newUsers30d, []) as { created_at: string }[];

  return NextResponse.json({
    totalUsers: val(totalUsers, 0),
    dau: val(dau, 0),
    totalMilesDB: val(totalMilesDB, 0),
    newUsersLast30d: newUsersArr.length,
    todayGames: val(todayGames, { total: 0, accepted: 0, rejected: 0, milesAwarded: 0, byType: {} }),
    milesSupply: val(milesSupply, 0),
    vaultTVL: val(vaultTVL, 0),
    diceStats: val(diceStats, { totalCreated: 0, totalResolved: 0, totalPayoutMiles: 0 }),
    treasuryPool: val(treasuryPool, 0),
  });
}
