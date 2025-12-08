// src/app/api/streaks/topup/route.ts
import { NextResponse } from "next/server";
import { userToppedUpAtLeast5DollarsInLast7Days } from "@/helpers/graphTopupStreak";
import { claimStreakReward } from "@/helpers/streaks";

/**
 * Weekly streak:
 *  - "Akiba Streak for weeks in a row topping up at least $5 in MiniPay"
 *  - One claim per ISO-week per questId
 *
 * POST /api/streaks/topup
 * body: { userAddress: string; questId: string }
 */
export async function POST(req: Request) {
  try {
    const { userAddress, questId } = await req.json();

    if (!userAddress || !questId) {
      return NextResponse.json(
        { success: false, message: "Missing userAddress or questId" },
        { status: 400 }
      );
    }

    // 1) verify on-chain topup condition
    const ok = await userToppedUpAtLeast5DollarsInLast7Days(userAddress);
    if (!ok) {
      return NextResponse.json({
        success: false,
        code: "condition-failed",
        message: "No MiniPay top-up ≥ $5 in the last 7 days",
      });
    }

    // 2) weekly reward
    const result = await claimStreakReward({
      userAddress,
      questId,
      points: 25, // tweak reward
      scope: "weekly",
      label: "topup-streak",
    });

    if (!result.ok && result.code === "already") {
      return NextResponse.json({ success: false, code: "already" });
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      scopeKey: result.scopeKey, // e.g. "2025-W01"
    });
  } catch (err) {
    console.error("[streak_topup] error", err);
    return NextResponse.json(
      { success: false, message: "server-error" },
      { status: 500 }
    );
  }
}
