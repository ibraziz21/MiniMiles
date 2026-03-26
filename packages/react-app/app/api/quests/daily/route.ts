// e.g. src/app/api/quests/daily/route.ts
import { claimQueuedDailyReward } from "@/lib/minipointQueue";
import { isBlacklisted } from "@/lib/blacklist";

export async function POST(req: Request) {
  try {
    const { userAddress, questId } = (await req.json()) as {
      userAddress?: string;
      questId?: string;
    };

    if (!userAddress || !questId) {
      return Response.json(
        { success: false, message: "userAddress and questId are required" },
        { status: 400 },
      );
    }

    const addr = userAddress as `0x${string}`;

    if (await isBlacklisted(addr)) {
      return Response.json({ success: false, message: "Forbidden" }, { status: 403 });
    }

    const today = new Date().toISOString().slice(0, 10);

    const POINTS = 10;
    const result = await claimQueuedDailyReward({
      userAddress: addr,
      questId,
      points: POINTS,
      scopeKey: today,
      reason: `daily-engagement:${questId}`,
    });

    if (!result.ok && result.code === "already") {
      return Response.json(
        { success: false, code: "already", message: "Already claimed today" },
        { status: 200 },
      );
    }

    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message ?? "queue-error" },
        { status: 500 },
      );
    }

    return Response.json(
      { success: true, txHash: result.txHash, queued: result.queued },
      { status: 200 },
    );
  } catch (err: any) {
    console.error("[daily-quest] unexpected error", err);
    return Response.json(
      {
        success: false,
        message: err?.shortMessage ?? err?.message ?? "Error minting points",
      },
      { status: 500 },
    );
  }
}
