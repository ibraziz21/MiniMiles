// src/app/api/quests/daily_transfer/route.ts
import { NextResponse } from "next/server";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";
import { userSentAtLeast1DollarIn24Hrs } from "@/helpers/graphQuestTransfer";

/* ───────────────────────── POST ───────────────────────── */
export async function POST(req: Request) {
  try {
    const { userAddress, questId } = await req.json();

    /* 1 ▸ already claimed today? */
    const today = new Date().toISOString().slice(0, 10);
    /* 1 ▸ on-chain subgraph check */
    if (!(await userSentAtLeast1DollarIn24Hrs(userAddress))) {
      return NextResponse.json({
        success: false,
        message: "No outgoing transfer ≥ $1 in the last 24 h",
      });
    }
    const result = await claimQueuedDailyReward({
      userAddress,
      questId,
      points: 15,
      scopeKey: today,
      reason: `daily-transfer:${questId}`,
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
    });
  } catch (err) {
    console.error("[daily_transfer]", err);
    return NextResponse.json({ success: false, message: "server-error" });
  }
}
