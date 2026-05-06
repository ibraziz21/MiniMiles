// app/api/quests/daily_transfer/route.ts
import { NextResponse } from "next/server";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";
import { userSentAtLeast1DollarIn24Hrs } from "@/helpers/graphQuestTransfer";
import { getQuest } from "@/lib/questRegistry";
import { requireSession, logSessionAge } from "@/lib/auth";

export async function POST(_req: Request) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });

    const addr = session.walletAddress;
    logSessionAge("quests/daily_transfer", addr, session.issuedAt);
    const quest = getQuest("daily_transfer");
    const today = new Date().toISOString().slice(0, 10);

    if (!(await userSentAtLeast1DollarIn24Hrs(addr))) {
      return NextResponse.json({ success: false, message: "No outgoing transfer ≥ $1 in the last 24 h" });
    }

    const result = await claimQueuedDailyReward({ userAddress: addr, questId: quest.questId, points: quest.points, scopeKey: today, reason: quest.reason });

    if (!result.ok && result.code === "already") return NextResponse.json({ success: false, code: "already" });
    if (!result.ok) return NextResponse.json({ success: false, message: "queue-error" }, { status: 500 });

    return NextResponse.json({ success: true, txHash: result.txHash, queued: result.queued, points: result.points, vaultBoost: result.vaultBoost });
  } catch (err) {
    console.error("[daily_transfer]", err);
    return NextResponse.json({ success: false, message: "server-error" });
  }
}
