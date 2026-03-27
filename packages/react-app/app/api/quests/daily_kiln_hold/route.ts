// app/api/quests/daily_kiln_hold/route.ts
import { NextResponse } from "next/server";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";
import { userErc20BalanceAtLeast } from "@/helpers/erc20Balance";
import { scopeKeyFor } from "@/helpers/streaks";
import { getQuest } from "@/lib/questRegistry";
import { requireSession } from "@/lib/auth";

const KILN_SHARE_TOKEN_ADDRESS = (process.env.KILN_SHARE_TOKEN_ADDRESS ?? "0xbaD4711D689329E315Be3E7C1C64CF652868C56c") as `0x${string}`;
const KILN_SHARE_TOKEN_DECIMALS = Number(process.env.KILN_SHARE_TOKEN_DECIMALS ?? "6");
const KILN_DAILY_MIN_HOLD = Number(process.env.KILN_DAILY_MIN_HOLD ?? "10");

export async function POST(_req: Request) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });

    const addr = session.walletAddress;
    const quest = getQuest("daily_kiln_hold");
    const today = scopeKeyFor("daily");

    const hasRequiredBalance = await userErc20BalanceAtLeast({
      userAddress: addr,
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

    const result = await claimQueuedDailyReward({ userAddress: addr, questId: quest.questId, points: quest.points, scopeKey: today, reason: quest.reason });

    if (!result.ok && result.code === "already") return NextResponse.json({ success: false, code: "already" });
    if (!result.ok) return NextResponse.json({ success: false, message: "queue-error" }, { status: 500 });

    return NextResponse.json({ success: true, txHash: result.txHash, queued: result.queued, claimedAt: today });
  } catch (err) {
    console.error("[daily_kiln_hold]", err);
    return NextResponse.json({ success: false, message: "server-error" }, { status: 500 });
  }
}
