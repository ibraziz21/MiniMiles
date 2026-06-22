import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { scopeKeyFor } from "@/helpers/streaks";
import {
  addUtcDays,
  buildSevenDaySendStreakStatus,
  dailyBreaksAt,
} from "@/lib/sevenDaySendStreak";

const TRACKED_STREAKS = [
  {
    id: "balance_10",
    questId: "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f",
    title: "$10 balance streak",
    cadence: "daily" as const,
    target: 7,
  },
  {
    id: "balance_30",
    questId: "a1ac5914-20d4-4436-bf02-29563938fe9d",
    title: "$30 balance streak",
    cadence: "daily" as const,
    target: 7,
  },
  {
    id: "balance_100",
    questId: "b5c7e1d2-6f8a-4b0c-9d2e-3a1f7c5b8e4d",
    title: "$100 balance streak",
    cadence: "daily" as const,
    target: 7,
  },
  {
    id: "topup",
    questId: "96009afb-0762-4399-adb3-ced421d73072",
    title: "$5 top-up streak",
    cadence: "weekly" as const,
    target: 4,
  },
] as const;

function utcDayEnd(date: Date) {
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCMilliseconds(-1);
  return end;
}

function isoWeekStart(year: number, week: number) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayNum = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayNum + 1 + (week - 1) * 7);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}

function parseWeekKey(key: string) {
  const [yearPart, weekPart] = key.split("-W");
  return isoWeekStart(Number(yearPart), Number(weekPart));
}

function weeklyBreaksAt(lastScopeKey: string, currentWeekKey: string): string | null {
  const last = parseWeekKey(lastScopeKey);
  const current = parseWeekKey(currentWeekKey);
  const weeksSince = Math.floor((current.getTime() - last.getTime()) / (7 * 86_400_000));

  if (weeksSince === 0) return utcDayEnd(addUtcDays(current, 13)).toISOString();
  if (weeksSince === 1) return utcDayEnd(addUtcDays(current, 6)).toISOString();
  return null;
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "auth_required" }, { status: 401 });

  const wallet = session.walletAddress.toLowerCase();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayKey = scopeKeyFor("daily", today);
  const weekKey = scopeKeyFor("weekly", today);

  const questIds = TRACKED_STREAKS.map((s) => s.questId);
  const { data: rows, error } = await supabase
    .from("streaks")
    .select("quest_id, scope, current_streak, longest_streak, last_scope_key")
    .eq("user_address", wallet)
    .in("quest_id", questIds);

  if (error) {
    console.error("[streaks/status]", error);
    return NextResponse.json({ error: "db-error" }, { status: 500 });
  }

  const byQuest = new Map((rows ?? []).map((r) => [String(r.quest_id), r]));
  const tracked = TRACKED_STREAKS.map((def) => {
    const row = byQuest.get(def.questId);
    const lastScopeKey = row?.last_scope_key ? String(row.last_scope_key) : null;
    const currentStreak = Number(row?.current_streak ?? 0);
    const longestStreak = Number(row?.longest_streak ?? 0);
    const breaksAt = lastScopeKey
      ? def.cadence === "weekly"
        ? weeklyBreaksAt(lastScopeKey, weekKey)
        : dailyBreaksAt(lastScopeKey, todayKey)
      : null;
    const completedCurrentScope = lastScopeKey === (def.cadence === "weekly" ? weekKey : todayKey);
    const broken = currentStreak <= 0 || !breaksAt;
    const progress = Math.min(def.target, Math.max(0, currentStreak));

    return {
      id: def.id,
      questId: def.questId,
      title: def.title,
      description: def.cadence === "weekly" ? "Claim once per week to extend it." : "Claim daily to extend it.",
      cadence: def.cadence,
      currentStreak: broken ? 0 : currentStreak,
      longestStreak,
      target: def.target,
      progress,
      daysLeft: Math.max(0, def.target - progress),
      claimable: false,
      rewardClaimed: false,
      broken,
      breaksAt,
      lastScopeKey,
      completedCurrentScope,
    };
  });

  let sevenDay;
  try {
    sevenDay = await buildSevenDaySendStreakStatus(supabase, wallet, today);
  } catch (error) {
    console.error("[streaks/status] seven-day send", error);
    return NextResponse.json({ error: "db-error" }, { status: 500 });
  }

  const streaks = [sevenDay, ...tracked];

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    streaks,
    activeCount: streaks.filter((s) => !s.broken).length,
    claimableCount: streaks.filter((s) => s.claimable).length,
  });
}
