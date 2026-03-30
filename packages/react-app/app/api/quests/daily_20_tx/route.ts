// app/api/quests/daily_20_tx/route.ts
import { NextResponse } from "next/server";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";
import { countOutgoingTransfersIn24H } from "@/helpers/graphQuestTransfer";
import { requireSession, logSessionAge } from "@/lib/auth";

export async function POST(_req: Request) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });

    const userAddress = session.walletAddress;
    logSessionAge("quests/daily_20_tx", userAddress, session.issuedAt);

    const questId = process.env.QUEST_ID_DAILY_20TX ?? "daily_20tx";
    const today = new Date().toISOString().slice(0, 10);

    const txs = await countOutgoingTransfersIn24H(userAddress);
    if (txs < 20) {
      return NextResponse.json({ success: false, message: `Only ${txs}/20 transfers in the last 24 h` });
    }

    const result = await claimQueuedDailyReward({
      userAddress,
      questId,
      points: 50,
      scopeKey: today,
      reason: `daily-20tx:${questId}`,
    });

    if (!result.ok && result.code === "already") return NextResponse.json({ success: false, code: "already" });
    if (!result.ok) return NextResponse.json({ success: false, message: "queue-error" }, { status: 500 });

    return NextResponse.json({ success: true, txHash: result.txHash, queued: result.queued });
  } catch (err) {
    console.error("[daily_20_tx]", err);
    return NextResponse.json({ success: false, message: "server-error" });
  }
}
