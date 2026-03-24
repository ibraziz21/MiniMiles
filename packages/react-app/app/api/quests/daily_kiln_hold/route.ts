import { NextResponse } from "next/server";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";
import { userErc20BalanceAtLeast } from "@/helpers/erc20Balance";
import { scopeKeyFor } from "@/helpers/streaks";

const KILN_SHARE_TOKEN_ADDRESS =
  (process.env.KILN_SHARE_TOKEN_ADDRESS ??
    "0xbaD4711D689329E315Be3E7C1C64CF652868C56c") as `0x${string}`;
const KILN_SHARE_TOKEN_DECIMALS = Number(
  process.env.KILN_SHARE_TOKEN_DECIMALS ?? "6"
);
const KILN_DAILY_MIN_HOLD = Number(process.env.KILN_DAILY_MIN_HOLD ?? "10");
const KILN_DAILY_POINTS = Number(process.env.KILN_DAILY_POINTS ?? "40");

export async function POST(req: Request) {
  try {
    const rawBody = await req.text();
    if (!rawBody.trim()) {
      return NextResponse.json(
        { success: false, message: "Empty request body" },
        { status: 400 }
      );
    }

    let parsedBody: { userAddress?: string; questId?: string };
    try {
      parsedBody = JSON.parse(rawBody);
    } catch (error) {
      console.error("[daily_kiln_hold] invalid json body", rawBody, error);
      return NextResponse.json(
        { success: false, message: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const { userAddress, questId } = parsedBody;

    if (!userAddress || !questId) {
      return NextResponse.json(
        { success: false, message: "Missing userAddress or questId" },
        { status: 400 }
      );
    }

    const today = scopeKeyFor("daily");
    const hasRequiredBalance = await userErc20BalanceAtLeast({
      userAddress,
      tokenAddress: KILN_SHARE_TOKEN_ADDRESS,
      minAmount: KILN_DAILY_MIN_HOLD,
      decimals: KILN_SHARE_TOKEN_DECIMALS,
    });

    if (!hasRequiredBalance) {
      return NextResponse.json({
        success: false,
        code: "condition-failed",
        message: `Need at least ${KILN_DAILY_MIN_HOLD} Kiln share tokens (~$${KILN_DAILY_MIN_HOLD}) in your wallet`,
      });
    }

    const result = await claimQueuedDailyReward({
      userAddress,
      questId,
      points: KILN_DAILY_POINTS,
      scopeKey: today,
      reason: "kiln-daily-hold",
    });

    if (!result.ok && result.code === "already") {
      return NextResponse.json({ success: false, code: "already" });
    }

    if (!result.ok) {
      return NextResponse.json(
        { success: false, message: result.message ?? "queue-error" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      txHash: result.txHash,
      queued: result.queued,
      claimedAt: today,
    });
  } catch (err) {
    console.error("[daily_kiln_hold] error", err);
    return NextResponse.json(
      { success: false, message: "server-error" },
      { status: 500 }
    );
  }
}
