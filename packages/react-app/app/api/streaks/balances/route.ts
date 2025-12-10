import { NextResponse } from "next/server";
import {
  getUserStableWalletBalanceUsd,
} from "@/helpers/walletStableBalance";
import { claimStreakReward } from "@/helpers/streaks";

/**
 * Daily streak:
 *  - "Akiba Streak for holding a balance of at least $10 and $30 USD with daily rewards"
 *  - We treat them as 2 quests; body.tier selects threshold:
 *      - tier "10" => min $10, e.g. 10 Miles/day
 *      - tier "30" => min $30, e.g. 20 Miles/day
 *
 * POST /api/streaks/balances
 * body: { userAddress: string; questId: string; tier: "10" | "30" }
 */
export async function POST(req: Request) {
  try {
    const { userAddress, questId, tier } = await req.json();

    if (!userAddress || !questId || !tier) {
      return NextResponse.json(
        { success: false, message: "Missing userAddress, questId or tier" },
        { status: 400 },
      );
    }

    const minUsd = tier === "30" ? 30 : 10;
    const points = tier === "30" ? 20 : 10; // tweak rewards

    // 1) check combined stable wallet balance
    const totalUsd = await getUserStableWalletBalanceUsd(userAddress);
    if (totalUsd < minUsd) {
      const missingUsd = Math.max(0, minUsd - totalUsd);
      return NextResponse.json({
        success: false,
        code: "condition-failed",
        message: `Need at least $${minUsd} in your wallet (cUSD/USDT/other stables)`,
        minUsd,
        currentUsd: totalUsd,
        missingUsd,
      });
    }

    // 2) daily reward + streak tracking
    const result = await claimStreakReward({
      userAddress,
      questId,
      points,
      scope: "daily",
      label: `wallet-${tier}-streak`,
    });

    if (!result.ok && result.code === "already") {
      return NextResponse.json({
        success: false,
        code: "already",
        scopeKey: result.scopeKey,
        currentStreak: result.currentStreak,
        longestStreak: result.longestStreak,
      });
    }

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          code: "error",
          message: "Could not claim streak reward",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      claimedAt: result.scopeKey, // YYYY-MM-DD
      scopeKey: result.scopeKey,
      currentStreak: result.currentStreak,
      longestStreak: result.longestStreak,
    });
  } catch (err) {
    console.error("[streak_wallet_balance] error", err);
    return NextResponse.json(
      { success: false, message: "server-error" },
      { status: 500 },
    );
  }
}
