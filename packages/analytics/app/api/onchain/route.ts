import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkApiAuth } from "@/lib/auth";
import { mintReasonCategory } from "@/lib/metrics";

export async function GET(request: NextRequest) {
  if (!checkApiAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const [allJobsRes, recentJobsRes] = await Promise.all([
      supabase
        .from("minipoint_mint_jobs")
        .select("user_address, points, status, reason, created_at"),
      supabase
        .from("minipoint_mint_jobs")
        .select("created_at, points, reason, status")
        .gte("created_at", thirtyDaysAgo),
    ]);

    const allJobs = allJobsRes.data ?? [];
    const recentJobs = recentJobsRes.data ?? [];

    const completedAll = allJobs.filter((j: { status: string }) => j.status === "completed");
    const completedRecent = recentJobs.filter((j: { status: string }) => j.status === "completed");

    // ── Category breakdown (pie) ─────────────────────────────────────────────
    const categoryMap: Record<string, { points: number; count: number; color: string }> = {};
    const CATEGORY_COLORS: Record<string, string> = {
      "Daily Quest": "#10b981",
      "Partner Quest": "#6366f1",
      "Streak": "#f59e0b",
      "Profile Milestone": "#3b82f6",
      "Prosperity Pass": "#8b5cf6",
      "Raffle": "#ec4899",
      "Game": "#14b8a6",
      "Other": "#6b7280",
    };

    completedAll.forEach((j: { reason: string; points: number }) => {
      const cat = mintReasonCategory(j.reason);
      if (!categoryMap[cat]) categoryMap[cat] = { points: 0, count: 0, color: CATEGORY_COLORS[cat] ?? "#6b7280" };
      categoryMap[cat].points += j.points ?? 0;
      categoryMap[cat].count++;
    });

    const pieData = Object.entries(categoryMap)
      .map(([name, v]) => ({ name, value: v.points, count: v.count, color: v.color }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value);

    // ── Daily minting volume — last 30 days ──────────────────────────────────
    const dailyVolumeMap: Record<string, number> = {};
    completedRecent.forEach((j: { created_at: string; points: number }) => {
      const day = j.created_at.split("T")[0];
      dailyVolumeMap[day] = (dailyVolumeMap[day] ?? 0) + (j.points ?? 0);
    });

    const dailyVolume = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const dateStr = d.toISOString().split("T")[0];
      dailyVolume.push({
        date: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        points: dailyVolumeMap[dateStr] ?? 0,
      });
    }

    // ── Top 20 earners (all completed jobs) ─────────────────────────────────
    const earnerMap: Record<string, number> = {};
    completedAll.forEach((j: { user_address: string; points: number }) => {
      earnerMap[j.user_address] = (earnerMap[j.user_address] ?? 0) + (j.points ?? 0);
    });

    const top20Earners = Object.entries(earnerMap)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([address, points], index) => ({
        rank: index + 1,
        address,
        shortAddress: `${address.slice(0, 6)}...${address.slice(-4)}`,
        totalPoints: points,
      }));

    // ── Quest breakdown by reason category ───────────────────────────────────
    const questBreakdownMap: Record<string, { name: string; points: number; mints: number }> = {};
    completedAll.forEach((j: { reason: string; points: number }) => {
      const name = mintReasonCategory(j.reason);
      if (!questBreakdownMap[name]) questBreakdownMap[name] = { name, points: 0, mints: 0 };
      questBreakdownMap[name].points += j.points ?? 0;
      questBreakdownMap[name].mints++;
    });

    const questBreakdownList = Object.values(questBreakdownMap)
      .sort((a, b) => b.points - a.points)
      .slice(0, 8);

    // ── Mint job status breakdown (queue health) ─────────────────────────────
    const statusMap: Record<string, { count: number; points: number }> = {};
    allJobs.forEach((j: { status: string; points: number }) => {
      if (!statusMap[j.status]) statusMap[j.status] = { count: 0, points: 0 };
      statusMap[j.status].count++;
      statusMap[j.status].points += j.points ?? 0;
    });

    const STATUS_COLORS: Record<string, string> = {
      completed: "#10b981",
      pending: "#f59e0b",
      processing: "#6366f1",
      failed: "#ef4444",
    };

    const statusBreakdown = Object.entries(statusMap).map(([status, v]) => ({
      status,
      count: v.count,
      points: v.points,
      color: STATUS_COLORS[status] ?? "#6b7280",
    }));

    // Totals by category for summary cards
    const dailyQuestPts = categoryMap["Daily Quest"]?.points ?? 0;
    const streakPts = categoryMap["Streak"]?.points ?? 0;
    const partnerPts = categoryMap["Partner Quest"]?.points ?? 0;
    const milestonePts = categoryMap["Profile Milestone"]?.points ?? 0;

    return NextResponse.json({
      pieData,
      dailyVolume,
      top20Earners,
      questBreakdownList,
      statusBreakdown,
      totals: {
        allTimeDailyPts: dailyQuestPts,
        allTimeStreakPts: streakPts,
        allTimePartnerPts: partnerPts,
        allTimeMilestonePts: milestonePts,
      },
    });
  } catch (error) {
    console.error("Onchain API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
