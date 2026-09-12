// src/app/api/streaks/balances
import { NextResponse } from "next/server";
import { userStableWalletBalanceAtLeastUsd } from "@/helpers/walletStableBalance";
import { claimStreakReward } from "@/helpers/streaks";
import { requireSession, logSessionAge } from "@/lib/auth";
import { isSelfClaimEnabledForWallet } from "@/lib/server/dailySelfClaimMode";
import { selfClaimRequiredResponse } from "@/lib/server/legacySelfClaimGate";
import { getBalanceStreakConfigByQuestId } from "@/lib/streakRegistry";

/**
 * Daily streak:
 *  - "Akiba Streak for holding a balance of at least $10/$30/$100 USD with daily rewards"
 *
 * POST /api/streaks/balances
 * body: { questId: string }
 *
 * docs/all-quests-self-claim-spec.md §5.5: the wallet comes from the session,
 * never from request JSON, and questId maps through the fixed
 * lib/streakRegistry.ts table — tier/minUsd/points are never taken from the
 * client (previously `tier` was an unchecked client-supplied string with no
 * link back to questId).
 */
export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });
    }
    const userAddress = session.walletAddress;
    logSessionAge("streaks/balances", userAddress, session.issuedAt);

    const body = await req.json().catch(() => ({}));
    const questId = typeof body?.questId === "string" ? body.questId : null;
    const config = questId ? getBalanceStreakConfigByQuestId(questId) : null;
    if (!config) {
      return NextResponse.json({ success: false, message: "Unknown or missing questId" }, { status: 400 });
    }

    if (isSelfClaimEnabledForWallet(`daily_balance_streak_${config.tier}`, userAddress)) {
      return selfClaimRequiredResponse();
    }

    // 1) check combined stable wallet balance
    const ok = await userStableWalletBalanceAtLeastUsd(userAddress, config.minUsd);
    if (!ok) {
      return NextResponse.json({
        success: false,
        code: "condition-failed",
        message: `Need at least $${config.minUsd} in your wallet (cUSD/USDT/other stables)`,
      });
    }

    // 2) daily reward
    const result = await claimStreakReward({
      userAddress,
      questId: config.questId,
      points: config.points,
      scope: "daily",
      label: `wallet-${config.tier}-streak`,
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
      points: result.points,
      txHash: result.txHash,
      queued: result.queued,
      claimedAt: result.scopeKey, // YYYY-MM-DD
      currentStreak: result.currentStreak,
      longestStreak: result.longestStreak,
    });
  } catch (err) {
    console.error("[streak_wallet_balance] error", err);
    return NextResponse.json(
      { success: false, message: "server-error" },
      { status: 500 }
    );
  }
}
