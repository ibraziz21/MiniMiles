// src/app/api/streaks/games/route.ts
import { NextResponse } from "next/server";
import { userPlayedAtLeastOneGameInLast24Hrs } from "@/helpers/graphGames";
import { claimStreakReward } from "@/helpers/streaks";

/**
 * Daily streak:
 *  - "Akiba Streak for days played at least 1 game"
 *
 * POST /api/streaks/games
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

    // 1) check game activity
    const ok = await userPlayedAtLeastOneGameInLast24Hrs(userAddress);
    if (!ok) {
      return NextResponse.json({
        success: false,
        code: "condition-failed",
        message: "No game activity in the last 24 hours",
      });
    }

    // 2) daily reward
    const result = await claimStreakReward({
      userAddress,
      questId,
      points: 15, // tweak reward
      scope: "daily",
      label: "games-streak",
    });

    if (!result.ok && result.code === "already") {
      return NextResponse.json({ success: false, code: "already" });
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      claimedAt: result.scopeKey, // YYYY-MM-DD
    });
  } catch (err) {
    console.error("[streak_games] error", err);
    return NextResponse.json(
      { success: false, message: "server-error" },
      { status: 500 }
    );
  }
}
