import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkApiAuth } from "@/lib/auth";

function getWeekKey(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function weekKeyToDisplay(weekKey: string): string {
  const [yearPart, weekPart] = weekKey.split("-W");
  return `${yearPart} W${weekPart}`;
}

function addWeeksToWeekKey(weekKey: string, offset: number): string {
  const [yearPart, weekPart] = weekKey.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const firstIsoMonday = new Date(jan4);
  firstIsoMonday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));

  const target = new Date(firstIsoMonday);
  target.setUTCDate(firstIsoMonday.getUTCDate() + (week - 1 + offset) * 7);
  return getWeekKey(target.toISOString().split("T")[0]);
}

type EngagementRow = {
  user_address: string;
  claimed_at: string;
};

type StreakRow = {
  user_address: string;
  current_streak: number | null;
};

type UserRow = {
  user_address: string;
  profile_milestone_50_claimed: boolean | null;
  profile_milestone_100_claimed: boolean | null;
};

export async function GET(request: NextRequest) {
  if (!checkApiAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const [dailyRes, partnerRes, streaksRes, usersRes] = await Promise.all([
      supabase.from("daily_engagements").select("user_address, claimed_at"),
      supabase.from("partner_engagements").select("user_address, claimed_at"),
      supabase.from("streaks").select("user_address, current_streak"),
      supabase
        .from("users")
        .select("user_address, profile_milestone_50_claimed, profile_milestone_100_claimed"),
    ]);

    const dailyRows = (dailyRes.data ?? []) as EngagementRow[];
    const partnerRows = (partnerRes.data ?? []) as EngagementRow[];
    const allEngagements = [...dailyRows, ...partnerRows];
    const allStreaks = (streaksRes.data ?? []) as StreakRow[];
    const users = (usersRes.data ?? []) as UserRow[];

    const dauMap: Record<string, Set<string>> = {};
    allEngagements.forEach((row) => {
      if (!dauMap[row.claimed_at]) dauMap[row.claimed_at] = new Set();
      dauMap[row.claimed_at].add(row.user_address);
    });

    const dauTrend = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.now() - (29 - index) * 24 * 60 * 60 * 1000);
      const key = date.toISOString().split("T")[0];
      return {
        date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        dau: dauMap[key]?.size ?? 0,
      };
    });

    const wauMap: Record<string, Set<string>> = {};
    allEngagements.forEach((row) => {
      const week = getWeekKey(row.claimed_at);
      if (!wauMap[week]) wauMap[week] = new Set();
      wauMap[week].add(row.user_address);
    });

    const wauTrend = Array.from({ length: 12 }, (_, index) => {
      const date = new Date(Date.now() - (11 - index) * 7 * 24 * 60 * 60 * 1000);
      const week = getWeekKey(date.toISOString().split("T")[0]);
      return {
        week: `W${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        wau: wauMap[week]?.size ?? 0,
      };
    });

    const userMaxStreak: Record<string, number> = {};
    users.forEach((user) => {
      userMaxStreak[user.user_address] = 0;
    });
    allStreaks.forEach((row) => {
      const current = Number(row.current_streak ?? 0);
      userMaxStreak[row.user_address] = Math.max(userMaxStreak[row.user_address] ?? 0, current);
    });

    const streakBuckets: Record<string, number> = {
      "0": 0,
      "1-3": 0,
      "4-7": 0,
      "8-14": 0,
      "15-30": 0,
      "30+": 0,
    };

    Object.values(userMaxStreak).forEach((value) => {
      if (value === 0) streakBuckets["0"] += 1;
      else if (value <= 3) streakBuckets["1-3"] += 1;
      else if (value <= 7) streakBuckets["4-7"] += 1;
      else if (value <= 14) streakBuckets["8-14"] += 1;
      else if (value <= 30) streakBuckets["15-30"] += 1;
      else streakBuckets["30+"] += 1;
    });

    const streakHistogram = Object.entries(streakBuckets).map(([range, count]) => ({
      range,
      count,
    }));

    const streakValues = Object.values(userMaxStreak);
    const activeStreakUsers = streakValues.filter((value) => value > 0).length;
    const avgStreak =
      streakValues.length > 0
        ? (streakValues.reduce((sum, value) => sum + value, 0) / streakValues.length).toFixed(1)
        : "0";

    const streak3Plus = streakValues.filter((value) => value >= 3).length;
    const streak7Plus = streakValues.filter((value) => value >= 7).length;

    const firstClaimMap: Record<string, string> = {};
    [...allEngagements]
      .sort((a, b) => a.claimed_at.localeCompare(b.claimed_at))
      .forEach((row) => {
        if (!firstClaimMap[row.user_address]) firstClaimMap[row.user_address] = row.claimed_at;
      });

    const cohortMap: Record<string, Set<string>> = {};
    Object.entries(firstClaimMap).forEach(([user, firstDate]) => {
      const cohortWeek = getWeekKey(firstDate);
      if (!cohortMap[cohortWeek]) cohortMap[cohortWeek] = new Set();
      cohortMap[cohortWeek].add(user);
    });

    const userActivityByWeek: Record<string, Set<string>> = {};
    allEngagements.forEach((row) => {
      const week = getWeekKey(row.claimed_at);
      if (!userActivityByWeek[row.user_address]) userActivityByWeek[row.user_address] = new Set();
      userActivityByWeek[row.user_address].add(week);
    });

    const cohortRows = Object.entries(cohortMap)
      .sort(([a], [b]) => b.localeCompare(a))
      .slice(0, 8)
      .map(([weekStart, usersInCohort]) => {
        const cohortSize = usersInCohort.size;
        const retentionWeeks: (number | null)[] = [];

        for (let offset = 1; offset <= 4; offset++) {
          const targetWeek = addWeeksToWeekKey(weekStart, offset);
          let returned = 0;

          usersInCohort.forEach((user) => {
            if (userActivityByWeek[user]?.has(targetWeek)) returned += 1;
          });

          retentionWeeks.push(cohortSize > 0 ? Math.round((returned / cohortSize) * 100) : 0);
        }

        return {
          week: weekKeyToDisplay(weekStart),
          cohortSize,
          w1: retentionWeeks[0],
          w2: retentionWeeks[1],
          w3: retentionWeeks[2],
          w4: retentionWeeks[3],
        };
      });

    const milestoneClaimed = users.filter(
      (user) => user.profile_milestone_50_claimed || user.profile_milestone_100_claimed
    ).length;

    const funnel = [
      { label: "All Registered Users", value: users.length, color: "#6366f1" },
      { label: "Ever Claimed a Quest", value: Object.keys(firstClaimMap).length, color: "#10b981" },
      { label: "Users with Active Streak", value: activeStreakUsers, color: "#f59e0b" },
      { label: "Users with 7+ Streak", value: streak7Plus, color: "#3b82f6" },
      { label: "Milestone Claimed", value: milestoneClaimed, color: "#ec4899" },
    ];

    return NextResponse.json({
      dauTrend,
      wauTrend,
      streakHistogram,
      activeStreamers: activeStreakUsers,
      avgStreak,
      cohortRows,
      funnel,
      streak3Plus,
      streak7Plus,
    });
  } catch (error) {
    console.error("Retention API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
