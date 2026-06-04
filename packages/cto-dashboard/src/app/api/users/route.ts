import { NextResponse } from "next/server";
import {
  getUserRegistrationTrend, getTopEarners,
  getProfileCompletionBuckets, getMilesLast30Days,
} from "@/lib/db";

export const revalidate = 120;

export async function GET() {
  const [trend, earners, profileBuckets, milesLast30] = await Promise.allSettled([
    getUserRegistrationTrend(30),
    getTopEarners(20),
    getProfileCompletionBuckets(),
    getMilesLast30Days(),
  ]);

  function val<T>(r: PromiseSettledResult<T>, fallback: T): T {
    return r.status === "fulfilled" ? r.value : fallback;
  }

  // Build daily miles-by-reason breakdown
  const milesRows = val(milesLast30, []) as { points: number; created_at: string; reason: string }[];
  const byDay: Record<string, number> = {};
  for (const r of milesRows) {
    const day = r.created_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + (r.points ?? 0);
  }
  const milesByDay = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, miles]) => ({ date, miles }));

  return NextResponse.json({
    registrationTrend: val(trend, []),
    topEarners: val(earners, []),
    profileBuckets: val(profileBuckets, []),
    milesByDay,
  });
}
