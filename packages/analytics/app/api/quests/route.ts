import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { checkApiAuth } from "@/lib/auth";

type QuestRow = {
  user_address: string;
  points_awarded: number | null;
  claimed_at: string;
  quests?: { title?: string | null } | null;
};

type PartnerQuestRow = {
  user_address: string;
  points_awarded: number | null;
  claimed_at: string;
  partner_quests?: { title?: string | null } | null;
};

export async function GET(request: NextRequest) {
  if (!checkApiAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];

    const [dailyRes, partnerRes] = await Promise.all([
      supabase
        .from("daily_engagements")
        .select("user_address, points_awarded, claimed_at, quests(title)")
        .order("claimed_at", { ascending: false }),
      supabase
        .from("partner_engagements")
        .select("user_address, points_awarded, claimed_at, partner_quests(title)")
        .order("claimed_at", { ascending: false }),
    ]);

    const dailyRows = (dailyRes.data ?? []) as QuestRow[];
    const partnerRows = (partnerRes.data ?? []) as PartnerQuestRow[];

    interface QuestStat {
      name: string;
      totalClaims: number;
      uniqueUsers: Set<string>;
      totalPoints: number;
      last7dClaims: number;
    }

    const statsMap: Record<string, QuestStat> = {};

    const addRow = (
      name: string,
      userAddress: string,
      points: number | null | undefined,
      claimedAt: string
    ) => {
      if (!statsMap[name]) {
        statsMap[name] = {
          name,
          totalClaims: 0,
          uniqueUsers: new Set(),
          totalPoints: 0,
          last7dClaims: 0,
        };
      }

      statsMap[name].totalClaims += 1;
      statsMap[name].uniqueUsers.add(userAddress);
      statsMap[name].totalPoints += points ?? 0;
      if (claimedAt >= sevenDaysAgo) statsMap[name].last7dClaims += 1;
    };

    dailyRows.forEach((row) => {
      const title = row.quests?.title?.trim() || "Untitled Daily Quest";
      addRow(title, row.user_address, row.points_awarded, row.claimed_at);
    });

    partnerRows.forEach((row) => {
      const title = row.partner_quests?.title?.trim() || "Untitled Partner Quest";
      addRow(`Partner: ${title}`, row.user_address, row.points_awarded, row.claimed_at);
    });

    const questStats = Object.values(statsMap)
      .map((stat) => ({
        name: stat.name,
        totalClaims: stat.totalClaims,
        uniqueUsers: stat.uniqueUsers.size,
        totalPoints: stat.totalPoints,
        last7dClaims: stat.last7dClaims,
      }))
      .sort((a, b) => b.totalClaims - a.totalClaims);

    const barData = questStats.map((quest) => ({
      name: quest.name,
      claims: quest.totalClaims,
      points: quest.totalPoints,
    }));

    const top5Names = questStats.slice(0, 5).map((quest) => quest.name);

    const trendIndex: Record<string, Record<string, number>> = {};
    const addTrend = (name: string, claimedAt: string) => {
      if (!top5Names.includes(name) || claimedAt < fourteenDaysAgo) return;
      if (!trendIndex[name]) trendIndex[name] = {};
      trendIndex[name][claimedAt] = (trendIndex[name][claimedAt] ?? 0) + 1;
    };

    dailyRows.forEach((row) => {
      const title = row.quests?.title?.trim() || "Untitled Daily Quest";
      addTrend(title, row.claimed_at);
    });
    partnerRows.forEach((row) => {
      const title = row.partner_quests?.title?.trim() || "Untitled Partner Quest";
      addTrend(`Partner: ${title}`, row.claimed_at);
    });

    const trendDays = Array.from({ length: 14 }, (_, i) => {
      const date = new Date(Date.now() - (13 - i) * 24 * 60 * 60 * 1000);
      return date.toISOString().split("T")[0];
    });

    const dailyTrend = trendDays.map((day) => {
      const entry: Record<string, unknown> = {
        date: new Date(day).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      };

      top5Names.forEach((name) => {
        entry[name] = trendIndex[name]?.[day] ?? 0;
      });

      return entry;
    });

    const colors = ["#10b981", "#6366f1", "#f59e0b", "#ef4444", "#3b82f6"];
    const top5Lines = top5Names.map((name, index) => ({
      key: name,
      name,
      color: colors[index],
    }));

    const totalActiveUsers = new Set([
      ...dailyRows.map((row) => row.user_address),
      ...partnerRows.map((row) => row.user_address),
    ]).size;

    return NextResponse.json({
      questStats,
      barData,
      dailyTrend,
      top5Lines,
      totalActiveUsers,
    });
  } catch (error) {
    console.error("Quests API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
