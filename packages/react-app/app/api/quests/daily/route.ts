// app/api/quests/daily/route.ts
import { claimQueuedDailyReward } from "@/lib/minipointQueue";
import { isBlacklisted } from "@/lib/blacklist";
import { getQuest } from "@/lib/questRegistry";
import { getCeloTxCount } from "@/lib/celoClient";
import { requireSession, logSessionAge } from "@/lib/auth";

// Minimum lifetime tx count before a wallet can claim daily check-in rewards.
// Prevents fresh bot wallets with zero history from farming.
const MIN_LIFETIME_TXS = Number(process.env.MIN_CELO_TX_COUNT ?? "3");

export async function POST(_req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return Response.json({ success: false, message: "Authentication required" }, { status: 401 });
    }

    const addr = session.walletAddress;
    logSessionAge("quests/daily", addr, session.issuedAt);

    if (await isBlacklisted(addr, "quests/daily")) {
      return Response.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    // Quest config is server-controlled — caller never supplies questId
    const quest = getQuest("daily_checkin");

    // On-chain gate: wallet must have prior activity on Celo.
    // This prevents scripted farming with freshly-generated wallets.
    let txCount: number;
    try {
      txCount = await getCeloTxCount(addr);
    } catch (e) {
      console.error("[daily-checkin] RPC error:", e);
      // Hard fail — do not allow bypass on RPC error
      return Response.json(
        { success: false, message: "Could not verify wallet activity. Please try again." },
        { status: 503 }
      );
    }

    if (txCount < MIN_LIFETIME_TXS) {
      return Response.json(
        {
          success: false,
          code: "insufficient-activity",
          message: "Do anything on Celo today to claim.",
        },
        { status: 403 }
      );
    }

    const today = new Date().toISOString().slice(0, 10);

    const result = await claimQueuedDailyReward({
      userAddress: addr,
      questId: quest.questId,
      points: quest.points,
      scopeKey: today,
      reason: quest.reason,
    });

    if (!result.ok && result.code === "already") {
      return Response.json(
        { success: false, code: "already", message: "Already claimed today" },
        { status: 200 }
      );
    }

    if (!result.ok) {
      return Response.json({ success: false, message: "queue-error" }, { status: 500 });
    }

    return Response.json(
      { success: true, txHash: result.txHash, queued: result.queued, points: result.points, vaultBoost: result.vaultBoost },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("[daily-checkin] unexpected error", err);
    return Response.json(
      { success: false, message: err?.message ?? "Error" },
      { status: 500 }
    );
  }
}
