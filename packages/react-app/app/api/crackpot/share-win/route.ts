// POST /api/crackpot/share-win
// Awards 10 bonus Miles for sharing a win. One claim per cycle per address.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";

const SHARE_BONUS_MILES = 10;

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

    const { cycleId } = await req.json();
    if (!cycleId) return NextResponse.json({ error: "cycleId required" }, { status: 400 });

    const userAddress = session.walletAddress.toLowerCase();
    const idempotencyKey = `crackpot-share-win:${cycleId}:${userAddress}`;

    // Check already claimed
    const { data: existing } = await supabase
      .from("minipoint_mint_jobs")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing) return NextResponse.json({ ok: false, code: "already" });

    // Verify this address actually won this cycle
    const { data: cycle } = await supabase
      .from("crackpot_cycles")
      .select("winner_address")
      .eq("id", cycleId)
      .eq("status", "cracked")
      .maybeSingle();

    if (!cycle || cycle.winner_address?.toLowerCase() !== userAddress) {
      return NextResponse.json({ error: "Not the winner of this cycle" }, { status: 403 });
    }

    const { error } = await supabase.from("minipoint_mint_jobs").insert({
      idempotency_key: idempotencyKey,
      user_address: userAddress,
      points: SHARE_BONUS_MILES,
      reason: `crackpot-share-win:${cycleId}`,
      status: "pending",
      payload: { kind: "crackpot_share_win", userAddress, cycleId, pointsAwarded: SHARE_BONUS_MILES },
    });

    if (error && error.code !== "23505") {
      return NextResponse.json({ error: "Failed to queue bonus" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, points: SHARE_BONUS_MILES });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "Error" }, { status: 500 });
  }
}
