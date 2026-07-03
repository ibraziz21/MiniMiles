/**
 * POST /api/games/farkle/[matchId]/react
 * Body: { emoji: "fire" | "cry" | "laugh" | "tongue" | "angry_censored" }
 *
 * Tap-to-send cosmetic reaction. Purely social — no effect on match state,
 * scoring, or settlement. Participant check, rate limiting, and insert are
 * performed atomically by the farkle_send_reaction DB function (migration 021)
 * to prevent concurrent-tap races.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type Ctx = { params: Promise<{ matchId: string }> };

const ALLOWED_EMOJI = new Set(["fire", "cry", "laugh", "tongue", "angry_censored"]);

export async function POST(req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { matchId } = await params;
  const address = session.walletAddress.toLowerCase();
  const body = await req.json().catch(() => null);
  const emoji = typeof body?.emoji === "string" ? body.emoji : null;

  if (!emoji || !ALLOWED_EMOJI.has(emoji))
    return NextResponse.json({ error: "invalid emoji" }, { status: 400 });

  const { data, error } = await supabase.rpc("farkle_send_reaction", {
    p_match_id: matchId,
    p_wallet: address,
    p_emoji: emoji,
  });

  if (error) {
    console.error("[farkle/react] RPC error", error);
    return NextResponse.json({ error: "failed to send reaction" }, { status: 500 });
  }

  const result = data as { ok?: boolean; id?: string; error?: string } | null;

  if (result?.error === "not_participant")
    return NextResponse.json({ error: "not a match player" }, { status: 403 });
  if (result?.error === "rate_limited")
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  if (!result?.ok)
    return NextResponse.json({ error: "failed to send reaction" }, { status: 500 });

  return NextResponse.json({ ok: true, id: result.id, emoji });
}
