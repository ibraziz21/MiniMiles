// src/app/api/streaks/topup/route.ts
import { NextResponse } from "next/server";
import { userToppedUpAtLeast5DollarsInLast7Days } from "@/helpers/graphTopupStreak";
import { claimStreakReward } from "@/helpers/streaks";
import { requireSession, logSessionAge } from "@/lib/auth";
import { isSelfClaimEnabledForWallet } from "@/lib/server/dailySelfClaimMode";
import { selfClaimRequiredResponse } from "@/lib/server/legacySelfClaimGate";
import { TOPUP_STREAK_POINTS, TOPUP_STREAK_QUEST_ID } from "@/lib/streakRegistry";

/**
 * Weekly streak:
 *  - "Akiba Streak for weeks in a row topping up at least $5 in MiniPay"
 *  - One claim per ISO-week
 *
 * POST /api/streaks/topup
 *
 * docs/all-quests-self-claim-spec.md §5.5: the wallet comes from the
 * session, never from request JSON, and the quest ID/reward come from the
 * fixed lib/streakRegistry.ts table — previously this route took questId
 * directly from the client with no registry link.
 */
export async function POST(_req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
    }
    const userAddress = session.walletAddress;
    logSessionAge("streaks/topup", userAddress, session.issuedAt);

    if (isSelfClaimEnabledForWallet("weekly_topup_streak", userAddress)) return selfClaimRequiredResponse();

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
      questId: TOPUP_STREAK_QUEST_ID,
      points: TOPUP_STREAK_POINTS,
      scope: "weekly",
      label: "topup-streak",
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
      scopeKey: result.scopeKey, // e.g. "2025-W01"
      currentStreak: result.currentStreak,
      longestStreak: result.longestStreak,
    });
  } catch (err) {
    console.error("[streak_topup] error", err);
    return NextResponse.json(
      { success: false, message: "server-error" },
      { status: 500 }
    );
  }
}
