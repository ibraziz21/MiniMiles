import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkApiAuth } from "@/lib/auth";
import { isStreakReason, resolveStreakName } from "@/lib/metrics";

type MintJobRow = {
  user_address: string;
  points: number | null;
  status: string;
  created_at: string;
  reason: string | null;
};

type PassportOpRow = {
  address: string;
  amount: number | null;
  type: "burn" | "refund";
  status: string;
};

type PhysicalRaffleEntryRow = {
  user_address: string;
};

export async function GET(request: NextRequest) {
  if (!checkApiAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [mintJobsRes, passportOpsRes, raffleEntriesRes] = await Promise.all([
      supabase
        .from("minipoint_mint_jobs")
        .select("user_address, points, status, created_at, reason"),
      supabase
        .from("passport_ops")
        .select("address, amount, type, status"),
      supabase.from("physical_raffle_entries").select("user_address"),
    ]);

    const allJobs = (mintJobsRes.data ?? []) as MintJobRow[];
    const completedJobs = allJobs.filter((job) => job.status === "completed");
    const passportOps = (passportOpsRes.data ?? []) as PassportOpRow[];
    const completedPassportOps = passportOps.filter((row) => row.status === "completed");
    const raffleEntries = (raffleEntriesRes.data ?? []) as PhysicalRaffleEntryRow[];

    const allStreakJobs = completedJobs.filter((job) => isStreakReason(job.reason));
    const sevenDayStreakJobs = completedJobs.filter((job) =>
      job.reason?.startsWith("seven-day-streak:")
    );
    const gameStreakJobs = completedJobs.filter(
      (job) => job.reason === "streak:games-streak"
    );

    const streakTrendMap: Record<string, number> = {};
    allStreakJobs.forEach((job) => {
      const day = job.created_at.split("T")[0];
      streakTrendMap[day] = (streakTrendMap[day] ?? 0) + 1;
    });

    const streakTrend = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(Date.now() - (13 - index) * 24 * 60 * 60 * 1000);
      const key = date.toISOString().split("T")[0];
      return {
        date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        claims: streakTrendMap[key] ?? 0,
      };
    });

    const completedBurns = completedPassportOps.filter((row) => row.type === "burn");
    const completedRefunds = completedPassportOps.filter((row) => row.type === "refund");

    const burnTotal = completedBurns.reduce(
      (sum, row) => sum + (row.amount ?? 0),
      0
    );
    const refundTotal = completedRefunds.reduce(
      (sum, row) => sum + (row.amount ?? 0),
      0
    );

    const activitySummary = [
      {
        category: "All Streak Rewards",
        totalClaims: allStreakJobs.length,
        uniqueUsers: new Set(allStreakJobs.map((job) => job.user_address)).size,
        totalPoints: allStreakJobs.reduce((sum, job) => sum + (job.points ?? 0), 0),
        color: "#10b981",
      },
      {
        category: "7-Day Streak",
        totalClaims: sevenDayStreakJobs.length,
        uniqueUsers: new Set(sevenDayStreakJobs.map((job) => job.user_address)).size,
        totalPoints: sevenDayStreakJobs.reduce((sum, job) => sum + (job.points ?? 0), 0),
        color: "#f59e0b",
      },
      {
        category: "Games Streak",
        totalClaims: gameStreakJobs.length,
        uniqueUsers: new Set(gameStreakJobs.map((job) => job.user_address)).size,
        totalPoints: gameStreakJobs.reduce((sum, job) => sum + (job.points ?? 0), 0),
        color: "#6366f1",
      },
      {
        category: "Passport Burns",
        totalClaims: completedBurns.length,
        uniqueUsers: new Set(completedBurns.map((row) => row.address)).size,
        totalPoints: burnTotal,
        color: "#ec4899",
      },
      {
        category: "Physical Raffle Entries",
        totalClaims: raffleEntries.length,
        uniqueUsers: new Set(raffleEntries.map((row) => row.user_address)).size,
        totalPoints: 0,
        color: "#3b82f6",
      },
    ];

    const barData = activitySummary.map((row) => ({
      name: row.category,
      claims: row.totalClaims,
      points: row.totalPoints,
    }));

    const streakBreakdown = Object.entries(
      allStreakJobs.reduce<Record<string, { claims: number; users: Set<string>; points: number }>>(
        (acc, job) => {
          const name = resolveStreakName(job.reason ?? "");
          if (!acc[name]) {
            acc[name] = { claims: 0, users: new Set(), points: 0 };
          }
          acc[name].claims += 1;
          acc[name].users.add(job.user_address);
          acc[name].points += job.points ?? 0;
          return acc;
        },
        {}
      )
    ).map(([name, stat]) => ({
      name,
      claims: stat.claims,
      uniqueUsers: stat.users.size,
      totalPoints: stat.points,
    }));

    return NextResponse.json({
      streakStats: {
        totalClaims: allStreakJobs.length,
        uniqueUsers: new Set(allStreakJobs.map((job) => job.user_address)).size,
        totalPoints: allStreakJobs.reduce((sum, job) => sum + (job.points ?? 0), 0),
      },
      sevenDayStats: {
        totalClaims: sevenDayStreakJobs.length,
        uniqueUsers: new Set(sevenDayStreakJobs.map((job) => job.user_address)).size,
        totalPoints: sevenDayStreakJobs.reduce((sum, job) => sum + (job.points ?? 0), 0),
      },
      gameStreakStats: {
        totalClaims: gameStreakJobs.length,
        uniqueUsers: new Set(gameStreakJobs.map((job) => job.user_address)).size,
        totalPoints: gameStreakJobs.reduce((sum, job) => sum + (job.points ?? 0), 0),
      },
      passStats: {
        completedBurns: completedBurns.length,
        completedRefunds: completedRefunds.length,
        uniqueAddresses: new Set(completedPassportOps.map((row) => row.address)).size,
        burnedPoints: burnTotal,
        refundedPoints: refundTotal,
      },
      raffleStats: {
        entryCount: raffleEntries.length,
        uniqueUsers: new Set(raffleEntries.map((row) => row.user_address)).size,
      },
      streakTrend,
      streakBreakdown,
      barData,
      activitySummary,
    });
  } catch (error) {
    console.error("Games API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
