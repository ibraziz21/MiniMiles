import { NextResponse } from "next/server";
import {
  getVaultTVL, getVaultTVLTrend,
  getTopVaultDepositors, getVaultFlowBreakdown,
} from "@/lib/db";
import { getVaultOnchainTVL } from "@/lib/chain";

export const revalidate = 120;

export async function GET() {
  const [tvlDB, tvlTrend, topDepositors, flowBreakdown, tvlOnchain] =
    await Promise.allSettled([
      getVaultTVL(),
      getVaultTVLTrend(30),
      getTopVaultDepositors(20),
      getVaultFlowBreakdown(30),
      getVaultOnchainTVL(),
    ]);

  function val<T>(r: PromiseSettledResult<T>, fallback: T): T {
    return r.status === "fulfilled" ? r.value : fallback;
  }

  return NextResponse.json({
    tvlDB: val(tvlDB, 0),
    tvlOnchain: val(tvlOnchain, 0),
    tvlTrend: val(tvlTrend, []),
    topDepositors: val(topDepositors, []),
    flowBreakdown: val(flowBreakdown, { deposits: 0, withdrawals: 0, netFlow: 0, txDeposits: 0, txWithdrawals: 0 }),
  });
}
