/**
 * POST /api/games/farkle/[matchId]/timeout
 *
 * The WAITING player calls this to claim victory when the player whose turn it
 * is has been idle past TURN_TIMEOUT_SECONDS. Server-validated against
 * turn_started_at — the client cannot fake a timeout.
 *
 * Idempotent: if the match is already completed with the caller as winner,
 * returns ok immediately (handles duplicate clicks / concurrent calls).
 *
 * Settlement dispatch failure is non-fatal: the DB match result is persisted
 * first; the reward is recovered by the reconcile sweep.
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { requireSession } from "@/lib/auth";
import { grantFarkleRewards } from "@/server/farkle/grantRewards";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type Ctx = { params: Promise<{ matchId: string }> };

const TURN_TIMEOUT_SECONDS = 60;

export async function POST(req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { matchId } = await params;
  const address = session.walletAddress.toLowerCase();

  const { data: match } = await supabase
    .from("game_matches")
    .select("*, game_modes(winner_miles_reward, loser_miles_reward, winner_reward_credit, mode_key)")
    .eq("id", matchId).single();
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });

  // Idempotency: match already completed with us as winner (duplicate / concurrent call)
  if (match.status === "completed" && match.winner_address === address) {
    console.log(`[farkle/timeout] matchId=${matchId} already completed — returning cached ok`);
    return NextResponse.json({ ok: true, winnerId: address, reason: "timeout", settlementStatus: "pending" });
  }

  if (match.status !== "in_progress")
    return NextResponse.json({ error: "match not active" }, { status: 400 });

  // Only the player who is NOT on turn may claim a timeout
  if (match.current_turn_address === address)
    return NextResponse.json({ error: "cannot time out your own turn" }, { status: 403 });

  // Validate the on-turn player has actually exceeded the deadline
  const turnStarted = match.turn_started_at ? new Date(match.turn_started_at).getTime() : 0;
  const elapsed = (Date.now() - turnStarted) / 1000;
  if (!turnStarted || elapsed < TURN_TIMEOUT_SECONDS)
    return NextResponse.json({ error: "opponent still has time", remaining: Math.max(0, TURN_TIMEOUT_SECONDS - elapsed) }, { status: 409 });

  const { data: players } = await supabase
    .from("game_match_players").select("*").eq("match_id", matchId);
  const me  = players?.find((p) => p.wallet_address === address);
  const opp = players?.find((p) => p.wallet_address !== address);
  if (!me) return NextResponse.json({ error: "not a match player" }, { status: 403 });
  if (!opp || opp.wallet_address !== match.current_turn_address)
    return NextResponse.json({ error: "invalid timeout target" }, { status: 400 });

  // Persist match completion — must succeed before attempting settlement dispatch.
  const { error: matchError } = await supabase.from("game_matches").update({
    status:         "completed",
    winner_address: address,
    loser_address:  opp.wallet_address,
    winner_score:   me.banked_score ?? 0,
    loser_score:    opp.banked_score ?? 0,
    completed_at:   new Date().toISOString(),
    metadata:       { ...match.metadata, endReason: "timeout" },
  }).eq("id", matchId).eq("status", "in_progress");

  if (matchError) {
    console.error(`[farkle/timeout] failed to complete match matchId=${matchId}`, matchError);
    return NextResponse.json({ error: "failed to complete match" }, { status: 500 });
  }

  await supabase.from("game_match_players").update({ result: "win"  }).eq("match_id", matchId).eq("wallet_address", address);
  await supabase.from("game_match_players").update({ result: "loss" }).eq("match_id", matchId).eq("wallet_address", opp.wallet_address);

  const modeKey   = (match.game_modes as any)?.mode_key ?? "";
  const winMiles  = (match.game_modes as any)?.winner_miles_reward ?? 10;
  const losMiles  = (match.game_modes as any)?.loser_miles_reward  ?? 5;
  const winCredit = (match.game_modes as any)?.winner_reward_credit ?? 0;

  console.log(
    `[farkle/timeout] match completed matchId=${matchId} modeKey=${modeKey}` +
    ` winner=${address} winnerScore=${me.banked_score ?? 0}` +
    ` loser=${opp.wallet_address} loserScore=${opp.banked_score ?? 0}`,
  );

  // Settlement dispatch — failure is recoverable via reconcile sweep.
  let settlementStatus: "settled" | "pending" = "pending";
  try {
    await grantFarkleRewards({
      matchId, modeKey,
      winnerAddress: address, loserAddress: opp.wallet_address,
      winnerScore: me.banked_score ?? 0, loserScore: opp.banked_score ?? 0,
      winMiles, losMiles, winCreditCents: winCredit, endReason: "timeout",
    });
    settlementStatus = "settled";
  } catch (err: any) {
    console.error(
      `[farkle/timeout] settlement dispatch failed matchId=${matchId} modeKey=${modeKey}` +
      ` winner=${address} — reconcile will retry. error=${err?.message ?? err}`,
    );
  }

  return NextResponse.json({ ok: true, winnerId: address, reason: "timeout", settlementStatus });
}
