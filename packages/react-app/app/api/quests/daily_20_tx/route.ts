// app/api/quests/daily_20_tx/route.ts
import { NextResponse } from "next/server";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";
import { countOutgoingTransfersIn24H } from "@/helpers/graphQuestTransfer";
import { getQuest } from "@/lib/questRegistry";
import { requireSession, logSessionAge } from "@/lib/auth";
import { isSelfClaimEnabledForWallet } from "@/lib/server/dailySelfClaimMode";
import { selfClaimRequiredResponse } from "@/lib/server/legacySelfClaimGate";

export async function POST(_req: Request) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ success: false, message: "Authentication required" }, { status: 401 });

    const userAddress = session.walletAddress;
    logSessionAge("quests/daily_20_tx", userAddress, session.issuedAt);

    if (isSelfClaimEnabledForWallet("daily_20tx", userAddress)) return selfClaimRequiredResponse();

    // docs/all-quests-self-claim-spec.md §8.1: now server-registry-driven
    // instead of a fallback literal questId ("daily_20tx") and hard-coded points.
    const quest = getQuest("daily_20tx");
    const today = new Date().toISOString().slice(0, 10);

    let txs: number;
    try {
      txs = await countOutgoingTransfersIn24H(userAddress, 20);
    } catch (err) {
      console.error("[daily_20_tx] RPC transfer count failed:", err);
      return NextResponse.json(
        { success: false, message: "Could not verify recent transfer activity. Please try again." },
        { status: 503 }
      );
    }
    if (txs < 20) {
      return NextResponse.json({ success: false, message: `Only ${txs}/20 transfers in the last 24 h` });
    }

    const result = await claimQueuedDailyReward({
      userAddress,
      questId: quest.questId,
      points: quest.points,
      scopeKey: today,
      reason: quest.reason,
    });

    if (!result.ok && result.code === "already") return NextResponse.json({ success: false, code: "already" });
    if (!result.ok) return NextResponse.json({ success: false, message: "queue-error" }, { status: 500 });

    return NextResponse.json({ success: true, txHash: result.txHash, queued: result.queued, points: result.points, vaultBoost: result.vaultBoost });
  } catch (err) {
    console.error("[daily_20_tx]", err);
    return NextResponse.json({ success: false, message: "server-error" });
  }
}
