import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkApiAuth } from "@/lib/auth";
import { fetchDuneScalarMetric } from "@/lib/dune";

export async function GET(request: NextRequest) {
  if (!checkApiAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const yesterday = new Date(now.getTime() - 86400000).toISOString().split("T")[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
      .toISOString()
      .split("T")[0];
    const sevenDaysAgoIso = new Date(now.getTime() - 7 * 86400000).toISOString();

    const [
      totalUsersRes,
      completedJobsRes,
      pendingRes,
      failedRes,
      recentCompletedJobsRes,
      trendJobsRes,
      totalReferralsRes,
      dailyAllRes,
      partnerAllRes,
      dailyRecentRes,
      partnerRecentRes,
      dailyTodayRes,
      partnerTodayRes,
      dailyYesterdayRes,
      partnerYesterdayRes,
      duneLifetimeUsers,
      duneWeeklyActiveUsers,
      duneRaffleMetric,
      duneTotalMinted,
    ] = await Promise.all([
      supabase.from("users").select("*", { count: "exact", head: true }),
      supabase
        .from("minipoint_mint_jobs")
        .select("user_address, points, created_at, reason")
        .eq("status", "completed"),
      supabase.from("minipoint_mint_jobs").select("points").eq("status", "pending"),
      supabase.from("minipoint_mint_jobs").select("points").eq("status", "failed"),
      supabase
        .from("minipoint_mint_jobs")
        .select("user_address, created_at")
        .eq("status", "completed")
        .gte("created_at", `${thirtyDaysAgo}T00:00:00`),
      supabase
        .from("minipoint_mint_jobs")
        .select("user_address, created_at")
        .eq("status", "completed")
        .gte("created_at", sevenDaysAgoIso),
      supabase
        .from("referrals")
        .select("*", { count: "exact", head: true })
        .not("redeemed_at", "is", null),
      supabase.from("daily_engagements").select("user_address"),
      supabase.from("partner_engagements").select("user_address"),
      supabase
        .from("daily_engagements")
        .select("user_address, claimed_at")
        .gte("claimed_at", thirtyDaysAgo),
      supabase
        .from("partner_engagements")
        .select("user_address, claimed_at")
        .gte("claimed_at", thirtyDaysAgo),
      supabase.from("daily_engagements").select("id").eq("claimed_at", today),
      supabase.from("partner_engagements").select("id").eq("claimed_at", today),
      supabase.from("daily_engagements").select("id").eq("claimed_at", yesterday),
      supabase.from("partner_engagements").select("id").eq("claimed_at", yesterday),
      fetchDuneScalarMetric({
        queryIdEnv: "DUNE_LIFETIME_USERS_QUERY_ID",
        columnEnv: "DUNE_LIFETIME_USERS_COLUMN",
        fallbackColumns: ["lifetime_users", "users", "count", "value"],
      }).catch(() => null),
      fetchDuneScalarMetric({
        queryIdEnv: "DUNE_WAU_QUERY_ID",
        columnEnv: "DUNE_WAU_COLUMN",
        fallbackColumns: ["weekly_active_users", "wau", "users", "count", "value"],
      }).catch(() => null),
      fetchDuneScalarMetric({
        queryIdEnv: "DUNE_RAFFLE_QUERY_ID",
        columnEnv: "DUNE_RAFFLE_COLUMN",
        fallbackColumns: ["raffle_entries", "entries", "participants", "count", "value"],
      }).catch(() => null),
      fetchDuneScalarMetric({
        queryIdEnv: "DUNE_TOTAL_MINTED_QUERY_ID",
        columnEnv: "DUNE_TOTAL_MINTED_COLUMN",
        fallbackColumns: ["akiba_issued", "total_minted", "minted", "value"],
      }).catch(() => null),
    ]);

    const completedJobs = completedJobsRes.data ?? [];
    const recentCompletedJobs = recentCompletedJobsRes.data ?? [];
    const dailyAll = dailyAllRes.data ?? [];
    const partnerAll = partnerAllRes.data ?? [];
    const dailyRecent = dailyRecentRes.data ?? [];
    const partnerRecent = partnerRecentRes.data ?? [];

    const totalMinted = completedJobs.reduce(
      (sum: number, row: { points: number }) => sum + (row.points ?? 0),
      0
    );

    const activeUsers = new Set<string>();
    for (const row of dailyAll) activeUsers.add((row as any).user_address);
    for (const row of partnerAll) activeUsers.add((row as any).user_address);
    for (const row of completedJobs) activeUsers.add((row as any).user_address);

    const mauUsers = new Set<string>();
    for (const row of dailyRecent) mauUsers.add((row as any).user_address);
    for (const row of partnerRecent) mauUsers.add((row as any).user_address);
    for (const row of recentCompletedJobs) mauUsers.add((row as any).user_address);

    const dauUsers = new Set<string>();
    for (const row of dailyRecent) {
      if ((row as any).claimed_at === today) dauUsers.add((row as any).user_address);
    }
    for (const row of partnerRecent) {
      if ((row as any).claimed_at === today) dauUsers.add((row as any).user_address);
    }
    for (const row of recentCompletedJobs) {
      if ((row as any).created_at?.startsWith(today)) {
        dauUsers.add((row as any).user_address);
      }
    }

    const pendingCount = (pendingRes.data ?? []).length;
    const pendingTotal = (pendingRes.data ?? []).reduce(
      (sum: number, row: { points: number }) => sum + (row.points ?? 0),
      0
    );
    const failedCount = (failedRes.data ?? []).length;
    const failedTotal = (failedRes.data ?? []).reduce(
      (sum: number, row: { points: number }) => sum + (row.points ?? 0),
      0
    );

    const trendJobs = trendJobsRes.data ?? [];
    const dauTrendMap: Record<string, Set<string>> = {};
    trendJobs.forEach((row: { user_address: string; created_at: string }) => {
      const day = row.created_at.split("T")[0];
      if (!dauTrendMap[day]) dauTrendMap[day] = new Set();
      dauTrendMap[day].add(row.user_address);
    });

    dailyRecent.forEach((row: any) => {
      if (!dauTrendMap[row.claimed_at]) dauTrendMap[row.claimed_at] = new Set();
      dauTrendMap[row.claimed_at].add(row.user_address);
    });

    partnerRecent.forEach((row: any) => {
      if (!dauTrendMap[row.claimed_at]) dauTrendMap[row.claimed_at] = new Set();
      dauTrendMap[row.claimed_at].add(row.user_address);
    });

    const dauTrend = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now.getTime() - (6 - i) * 86400000);
      const key = date.toISOString().split("T")[0];
      return {
        date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        dau: dauTrendMap[key]?.size ?? 0,
      };
    });

    return NextResponse.json({
      totalUsers: totalUsersRes.count ?? 0,
      activeUsers: duneLifetimeUsers ?? activeUsers.size,
      dau: dauUsers.size,
      mau: mauUsers.size,
      wau: duneWeeklyActiveUsers ?? null,
      totalMinted: duneTotalMinted ?? totalMinted,
      claimsToday: (dailyTodayRes.data ?? []).length + (partnerTodayRes.data ?? []).length,
      claimsYesterday:
        (dailyYesterdayRes.data ?? []).length + (partnerYesterdayRes.data ?? []).length,
      mintQueue: { pendingCount, pendingTotal, failedCount, failedTotal },
      totalReferrals: totalReferralsRes.count ?? 0,
      raffleMetric: duneRaffleMetric,
      dauTrend,
    });
  } catch (error) {
    console.error("Overview API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
