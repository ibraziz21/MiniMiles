// src/app/api/quests/seven_day_streak/route.ts
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";

/* ───────────────────────── env ────────────────────────── */
const { SUPABASE_URL = "", SUPABASE_SERVICE_KEY = "" } = process.env;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

/* ───────────────────────── consts ─────────────────────── */

// This is the quest for "Daily send ≥ $1" (used as the base condition)
const DAILY_SEND_QUEST_ID = "383eaa90-75aa-4592-a783-ad9126e8f04d";

// This must match the ID used in DailyChallenges.tsx
const SEVEN_DAY_STREAK_QUEST_ID = "6ddc811a-1a4d-4e57-871d-836f07486531";

// Reward for completing the 7-day streak
const STREAK_REWARD_POINTS = 200;

/* ───────────────────────── helpers ────────────────────── */

function getLast7DatesUtc(): { dates: string[]; oldest: string; newest: string } {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const dates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const newest = dates[0]; // today
  const oldest = dates[6]; // 6 days ago
  return { dates, oldest, newest };
}

/* ───────────────────────── POST ───────────────────────── */

export async function POST(req: Request) {
  try {
    const { userAddress, questId } = await req.json();

    if (!userAddress || !questId) {
      return NextResponse.json({
        success: false,
        message: "missing-params",
      });
    }

    if (questId !== SEVEN_DAY_STREAK_QUEST_ID) {
      return NextResponse.json({
        success: false,
        message: "invalid-quest",
      });
    }

    const { dates, oldest, newest } = getLast7DatesUtc();

    /* 1 ▸ has user already claimed this streak within this window? */
    const { data: alreadyClaimed, error: alreadyErr } = await supabase
      .from("daily_engagements")
      .select("id")
      .eq("user_address", userAddress)
      .eq("quest_id", questId)
      .gte("claimed_at", oldest)
      .lte("claimed_at", newest)
      .maybeSingle();

    if (alreadyErr) {
      console.error("[seven_day_streak] error checking existing claims", alreadyErr);
    }

    if (alreadyClaimed) {
      return NextResponse.json({ success: false, code: "already" });
    }

    /* 2 ▸ check that the user completed the daily $1 SEND quest
           for all of the last 7 days (consecutive streak) */
    const { data: streakRows, error: streakErr } = await supabase
      .from("daily_engagements")
      .select("claimed_at")
      .eq("user_address", userAddress)
      .eq("quest_id", DAILY_SEND_QUEST_ID)
      .in("claimed_at", dates);

    if (streakErr) {
      console.error("[seven_day_streak] streak query error", streakErr);
      return NextResponse.json({
        success: false,
        message: "server-error",
      });
    }

    const streakCount = streakRows?.length ?? 0;

    if (streakCount !== 7) {
      return NextResponse.json({
        success: false,
        message: "You need 7 days in a row of sending ≥ $1 to claim this.",
      });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const result = await claimQueuedDailyReward({
      userAddress,
      questId,
      points: STREAK_REWARD_POINTS,
      scopeKey: todayStr,
      reason: `seven-day-streak:${questId}`,
    });

    if (!result.ok && result.code === "already") {
      return NextResponse.json({ success: false, code: "already" });
    }

    if (!result.ok) {
      return NextResponse.json({
        success: false,
        message: "queue-error",
      });
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      queued: result.queued,
    });
  } catch (err) {
    console.error("[seven_day_streak]", err);
    return NextResponse.json({ success: false, message: "server-error" });
  }
}
