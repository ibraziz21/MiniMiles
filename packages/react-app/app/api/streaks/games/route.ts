// src/app/api/streaks/games/route.ts
import { NextResponse } from "next/server";
import { userPlayedAtLeastOneGameInLast24Hrs } from "@/helpers/graphGames";
import { claimStreakReward } from "@/helpers/streaks";
import { requireSession, logSessionAge } from "@/lib/auth";
import { getQuest } from "@/lib/questRegistry";
import { isSelfClaimEnabledForWallet } from "@/lib/server/dailySelfClaimMode";
import { selfClaimRequiredResponse } from "@/lib/server/legacySelfClaimGate";

/**
 * Daily streak:
 *  - "Akiba Streak for days played at least 1 game"
 *
 * POST /api/streaks/games
 *
 * docs/all-quests-self-claim-spec.md §5.5: the wallet comes from the
 * session, never from request JSON, and the quest ID comes from the fixed
 * server registry — previously this route took questId directly from the
 * client with no registry at all.
 */
export async function POST(_req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
    }
    const userAddress = session.walletAddress;
    logSessionAge("streaks/games", userAddress, session.issuedAt);

    if (isSelfClaimEnabledForWallet("daily_games_streak", userAddress)) return selfClaimRequiredResponse();

    const quest = getQuest("games_streak");

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
      questId: quest.questId,
      points: quest.points,
      scope: "daily",
      label: "games-streak",
    });

    if (!result.ok && result.code === "already") {
      return NextResponse.json({
        success: false,
        code: "already",
        currentStreak: result.currentStreak,
        longestStreak: result.longestStreak,
      });
    }

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          message: "server-error",
          currentStreak: result.currentStreak,
          longestStreak: result.longestStreak,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      queued: result.queued,
      points: result.points,
      claimedAt: result.scopeKey, // YYYY-MM-DD
      currentStreak: result.currentStreak,
      longestStreak: result.longestStreak,
    });
  } catch (err) {
    console.error("[streak_games] error", err);
    return NextResponse.json(
      { success: false, message: "server-error" },
      { status: 500 }
    );
  }
}
