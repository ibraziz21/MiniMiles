// e.g. src/app/api/quests/daily/route.ts
import { createClient } from "@supabase/supabase-js";
import { safeMintMiniPoints } from "@/app/api/partner-quests/username/route";

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

    // 2) Mint 20 points using shared safe helper
    const POINTS = 20;

    const txHash = await safeMintMiniPoints({
      to: addr,
      points: POINTS,
      reason: `daily-engagement:${questId}`,
    });

    // 3) Log claim in Supabase
    const { error: insertErr } = await supabase.from("daily_engagements").insert({
      user_address: addr,
      quest_id: questId,
      claimed_at: today,
      points_awarded: POINTS,
    });

    if (insertErr) {
      console.error("[daily-quest] insert daily_engagements error:", insertErr);
      return Response.json(
        { success: false, message: "db-error" },
        { status: 500 },
      );
    }

    return Response.json({ success: true, txHash }, { status: 200 });
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
