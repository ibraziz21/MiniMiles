import { NextResponse } from "next/server";
import { topupProgressLast7Days } from "@/helpers/graphTopupStreak";
import { claimStreakReward } from "@/helpers/streaks";

export async function POST(req: Request) {
  try {
    const { userAddress, questId } = await req.json();

    if (!userAddress || !questId) {
      return NextResponse.json(
        { success: false, message: "Missing userAddress or questId" },
        { status: 400 },
      );
    }

    // cumulative progress
    const progress = await topupProgressLast7Days(userAddress, 5);
    if (!progress.meets) {
      const remaining = Math.max(0, progress.shortfallUsd);
      return NextResponse.json({
        success: false,
        code: "condition-failed",
        message: `You need $${remaining.toFixed(
          2,
        )} more in MiniPay top-ups this week to complete this streak.`,
        totalUsd: Number(progress.totalUsd.toFixed(2)),
        targetUsd: progress.targetUsd,
        remainingUsd: Number(remaining.toFixed(2)),
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
      return NextResponse.json({ success: false, code: "already" });
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
