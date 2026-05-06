import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { supabase } from "@/lib/supabaseClient";
import { scopeKeyFor } from "@/helpers/streaks";

const DAILY_SEND_QUEST_ID = "383eaa90-75aa-4592-a783-ad9126e8f04d";
const SEVEN_DAY_STREAK_QUEST_ID = "6ddc811a-1a4d-4e57-871d-836f07486531";

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

function addUtcDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function utcDayEnd(date: Date) {
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCMilliseconds(-1);
  return end;
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

function dailyBreaksAt(lastScopeKey: string, todayKey: string): string | null {
  const last = parseDateKey(lastScopeKey);
  const today = parseDateKey(todayKey);
  const daysSince = Math.floor((today.getTime() - last.getTime()) / 86_400_000);

  if (daysSince === 0) return utcDayEnd(addUtcDays(today, 1)).toISOString();
  if (daysSince === 1) return utcDayEnd(today).toISOString();
  return null;
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

function runLengthEndingAt(claimed: Set<string>, newestAllowed: Date) {
  let count = 0;
  for (let i = 0; i < 14; i++) {
    const key = dateKey(addUtcDays(newestAllowed, -i));
    if (!claimed.has(key)) break;
    count++;
  }
  return count;
}

async function buildSevenDayStatus(wallet: string, today: Date) {
  const dates = Array.from({ length: 14 }, (_, i) => dateKey(addUtcDays(today, -i)));
  const lastSeven = dates.slice(0, 7);

  const [{ data: sendRows }, { data: claimRows }] = await Promise.all([
    supabase
      .from("daily_engagements")
      .select("claimed_at")
      .eq("user_address", wallet)
      .eq("quest_id", DAILY_SEND_QUEST_ID)
      .in("claimed_at", dates),
    supabase
      .from("daily_engagements")
      .select("claimed_at")
      .eq("user_address", wallet)
      .eq("quest_id", SEVEN_DAY_STREAK_QUEST_ID)
      .in("claimed_at", lastSeven),
  ]);

  const claimedDays = new Set((sendRows ?? []).map((r) => String(r.claimed_at).slice(0, 10)));
  const completedLastSeven = lastSeven.filter((d) => claimedDays.has(d)).length;
  const newestAllowed = claimedDays.has(lastSeven[0]) ? today : addUtcDays(today, -1);
  const currentStreak = runLengthEndingAt(claimedDays, newestAllowed);
  const lastClaimed = dates.find((d) => claimedDays.has(d)) ?? null;
  const completedCurrentScope = claimedDays.has(lastSeven[0]);
  const sevenRewardClaimed = (claimRows ?? []).length > 0;
  const claimable = completedLastSeven === 7 && !sevenRewardClaimed;
  const todayKey = dateKey(today);
  const breaksAt = lastClaimed ? dailyBreaksAt(lastClaimed, todayKey) : null;

  return {
    id: "seven_day_send",
    title: "7-day send streak",
    description: "Claim the daily send quest 7 days in a row.",
    cadence: "daily",
    currentStreak,
    longestStreak: currentStreak,
    target: 7,
    progress: Math.min(7, completedLastSeven),
    daysLeft: Math.max(0, 7 - Math.min(7, completedLastSeven)),
    claimable,
    rewardClaimed: sevenRewardClaimed,
    broken: currentStreak === 0,
    breaksAt,
    lastScopeKey: lastClaimed,
    completedCurrentScope,
  };
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

  const sevenDay = await buildSevenDayStatus(wallet, today);
  const streaks = [sevenDay, ...tracked];

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    streaks,
    activeCount: streaks.filter((s) => !s.broken).length,
    claimableCount: streaks.filter((s) => s.claimable).length,
  });
}
