// src/app/api/streaks/topup/route.ts
import { NextResponse } from "next/server";
import { topupProgressLast7Days } from "@/helpers/graphTopupStreak";
import { claimStreakReward } from "@/helpers/streaks";

// simple helper: next Monday (you can tweak)
function nextWeeklyClaimDate(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun,1=Mon,...6=Sat
  // days until next Monday
  const diff = (8 - day) % 7 || 7;
  const next = new Date(now);
  next.setDate(now.getDate() + diff);
  return next.toISOString().slice(0, 10); // YYYY-MM-DD
}

export async function POST(req: Request) {
  try {
    const { userAddress, questId } = await req.json();

    if (!userAddress || !questId) {
      return NextResponse.json(
        { success: false, message: "Missing userAddress or questId" },
        { status: 400 },
      );
    }

    // cumulative progress over last 7 days
    const progress = await topupProgressLast7Days(userAddress, 5);

    if (!progress.meets) {
      const remaining = Math.max(0, progress.shortfallUsd);
      const remainingFixed = Number(remaining.toFixed(2));

      return NextResponse.json({
        success: false,
        code: "condition-failed",
        message: `You need $${remainingFixed.toFixed(
          2,
        )} more in MiniPay top-ups this week to complete this streak.`,
        totalUsd: Number(progress.totalUsd.toFixed(2)),
        targetUsd: progress.targetUsd,
        remainingUsd: remainingFixed,
        // 👇 alias so the DailyChallenges logic can read `missingUsd`
        missingUsd: remainingFixed,
      });
    }

    const result = await claimStreakReward({
      userAddress,
      questId,
      points: 25,
      scope: "weekly",
      label: "topup-streak",
    });

    if (!result.ok && result.code === "already") {
      return NextResponse.json({
        success: false,
        code: "already",
        scopeKey: result.scopeKey,
        currentStreak: result.currentStreak,
        longestStreak: result.longestStreak,
        // 👇 next calendar weekly window start
        nextClaimDate: nextWeeklyClaimDate(),
      });
    }

    if (!result.ok) {
      return NextResponse.json(
        { success: false, message: "streak-error" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      scopeKey: result.scopeKey,
      streak: result.currentStreak, // 👈 what we use in UI
      longestStreak: result.longestStreak,
    });
  } catch (err) {
    console.error("[streak_topup] error", err);
    return NextResponse.json(
      { success: false, message: "server-error" },
      { status: 500 },
    );
  }
}
