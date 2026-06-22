// src/app/api/quests/seven_day_streak/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";
import { supabase } from "@/lib/supabaseClient";
import {
  buildSevenDaySendStreakStatus,
  SEVEN_DAY_STREAK_QUEST_ID,
} from "@/lib/sevenDaySendStreak";

/* ───────────────────────── consts ─────────────────────── */

// Reward for completing the 7-day streak
const STREAK_REWARD_POINTS = 200;

function todayKeyUtc() {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return today.toISOString().slice(0, 10);
}

/* ───────────────────────── POST ───────────────────────── */

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const questId = body?.questId;

    if (!questId) {
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

    const userAddress = session.walletAddress.toLowerCase();
    const streak = await buildSevenDaySendStreakStatus(supabase, userAddress);

    if (streak.rewardClaimed) {
      return NextResponse.json({ success: false, code: "already" });
    }

    if (!streak.claimable) {
      return NextResponse.json({
        success: false,
        code: "condition-failed",
        currentStreak: streak.currentStreak,
        progress: streak.progress,
        daysLeft: streak.daysLeft,
        message: "You need 7 days in a row of sending ≥ $1 to claim this.",
      });
    }

    const result = await claimQueuedDailyReward({
      userAddress,
      questId,
      points: STREAK_REWARD_POINTS,
      scopeKey: todayKeyUtc(),
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
      points: result.points,
      vaultBoost: result.vaultBoost,
    });
  } catch (err) {
    console.error("[seven_day_streak]", err);
    return NextResponse.json({ success: false, message: "server-error" });
  }
}
