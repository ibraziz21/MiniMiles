// e.g. src/app/api/quests/daily/route.ts
import { createClient } from "@supabase/supabase-js";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";

// ENVIRONMENT VARIABLES
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

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

    const today = new Date().toISOString().slice(0, 10); // e.g. "2025-04-15"

    // 1) Check Supabase: already claimed today?
    const { data: claimed, error: claimedErr } = await supabase
      .from("daily_engagements")
      .select("*")
      .eq("user_address", addr)
      .eq("quest_id", questId)
      .eq("claimed_at", today)
      .maybeSingle();

    if (claimedErr) {
      console.error("[daily-quest] claim lookup error:", claimedErr);
      return Response.json(
        { success: false, message: "db-error" },
        { status: 500 },
      );
    }

    if (claimed) {
      return Response.json(
        { success: false, message: "Already claimed today" },
        { status: 400 },
      );
    }

    const POINTS = 20;
    const result = await claimQueuedDailyReward({
      userAddress: addr,
      questId,
      points: POINTS,
      scopeKey: today,
      reason: `daily-engagement:${questId}`,
    });

    if (!result.ok && result.code === "already") {
      return Response.json(
        { success: false, message: "Already claimed today" },
        { status: 400 },
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
