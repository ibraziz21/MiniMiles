import { NextResponse } from "next/server";
import {
  getQuestCompletionRates, getQuestDailyTrend,
  getStreakHealth, getMintJobsByReason, getPendingMintJobs,
} from "@/lib/db";

export const revalidate = 120;

export async function GET() {
  const [rates, trend, streaks, mintByReason, pendingJobs] = await Promise.allSettled([
    getQuestCompletionRates(14),
    getQuestDailyTrend(14),
    getStreakHealth(),
    getMintJobsByReason(30),
    getPendingMintJobs(),
  ]);

  function val<T>(r: PromiseSettledResult<T>, fallback: T): T {
    return r.status === "fulfilled" ? r.value : fallback;
  }

  return NextResponse.json({
    questRates: val(rates, []),
    dailyTrend: val(trend, []),
    streakHealth: val(streaks, []),
    mintByReason: val(mintByReason, []),
    pendingMintJobs: val(pendingJobs, { rows: [], total: 0 }),
  });
}
