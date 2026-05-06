import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";

const SHARE_BONUS_MILES = 10;
const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY ?? "";

const supabase = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
  : null;

export async function POST(req: Request) {
  try {
    if (!supabase) {
      return NextResponse.json({ error: "Server not configured" }, { status: 500 });
    }

    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { roundId } = await req.json();
    if (!roundId) {
      return NextResponse.json({ error: "Missing roundId" }, { status: 400 });
    }

    const userAddress = session.walletAddress.toLowerCase();
    const idempotencyKey = `dice-share-win:${roundId}:${userAddress}`;

    // Check if already claimed
    const { data: existing } = await supabase
      .from("minipoint_mint_jobs")
      .select("id, status")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: false, code: "already", message: "Share bonus already claimed for this round" });
    }

    // Enqueue the mint job
    const { error } = await supabase
      .from("minipoint_mint_jobs")
      .insert({
        idempotency_key: idempotencyKey,
        user_address: userAddress,
        points: SHARE_BONUS_MILES,
        reason: `dice-share-win:${roundId}`,
        status: "pending",
        payload: {
          kind: "dice_share_win",
          userAddress,
          roundId: roundId.toString(),
          pointsAwarded: SHARE_BONUS_MILES,
        },
      });

    if (error && error.code !== "23505") {
      console.error("[dice/share-win]", error);
      return NextResponse.json({ error: "Failed to queue bonus" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, points: SHARE_BONUS_MILES });
  } catch (err: any) {
    console.error("[dice/share-win] unexpected error", err);
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
