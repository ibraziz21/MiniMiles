/**
 * POST /api/games/farkle/[matchId]/roll
 *
 * Body: { address: string; holdIndices?: number[] }
 *
 * holdIndices = dice indices the player is LOCKING before rolling the rest.
 *   - First roll of turn: empty / omitted → roll all 6 fresh.
 *   - Re-roll: must be non-empty + must score > 0 → roll remaining dice.
 *
 * Returns the full 6-die array (held positions keep their value, rolled positions
 * get new values), plus scoring metadata.
 */
import { NextResponse } from "next/server";
import { createClient }  from "@supabase/supabase-js";
import {
  rollDice, scoreSelected, hasAnyScoringDie, getScoringIndices,
  type DiceValue,
} from "@/lib/farkle/engine";
import { requireSession } from "@/lib/auth";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type Ctx = { params: Promise<{ matchId: string }> };

function normalizeHoldIndices(value: unknown): number[] | null {
  if (value == null) return [];
  if (!Array.isArray(value)) return null;
  const seen = new Set<number>();
  for (const item of value) {
    if (!Number.isInteger(item) || item < 0 || item > 5 || seen.has(item)) return null;
    seen.add(item);
  }
  return [...seen];
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { matchId } = await params;
  const body        = await req.json().catch(() => null);
  const address     = session.walletAddress.toLowerCase();
  const holdIndices = normalizeHoldIndices(body?.holdIndices);

  if (!holdIndices) return NextResponse.json({ error: "invalid holdIndices" }, { status: 400 });

  const { data: match } = await supabase.from("game_matches")
    .select("*, game_modes(target_score)").eq("id", matchId).single();
  if (!match)                                 return NextResponse.json({ error: "not found" },      { status: 404 });
  if (match.status !== "in_progress")         return NextResponse.json({ error: "not active" },     { status: 400 });
  if (match.current_turn_address !== address) return NextResponse.json({ error: "not your turn" },  { status: 403 });

  const seed = match.metadata?.seed ?? "";

  const { data: prevRolls } = await supabase.from("farkle_turns")
    .select("*")
    .eq("match_id", matchId).eq("wallet_address", address)
    .eq("turn_number", match.turn_number)
    .order("roll_number", { ascending: false })
    .limit(1);

  const lastRoll   = prevRolls?.[0] ?? null;
  const rollNumber = lastRoll ? lastRoll.roll_number + 1 : 1;
  const isFirstRoll = !lastRoll;

  // On a re-roll, validate + score the dice the player is holding
  let newTurnPoints = lastRoll?.turn_points ?? 0;
  const prevDice: number[] = lastRoll?.dice_values ?? [];
  let lockedSoFar: number[] = lastRoll?.selected_dice ?? [];

  if (!isFirstRoll) {
    if (holdIndices.length === 0)
      return NextResponse.json({ error: "must hold at least one scoring die to roll again" }, { status: 400 });
    if (holdIndices.some((i) => lockedSoFar.includes(i)))
      return NextResponse.json({ error: "already locked dice cannot be scored again" }, { status: 400 });

    const scored = scoreSelected(prevDice as DiceValue[], holdIndices);
    if (scored.score === 0)
      return NextResponse.json({ error: "selected dice score 0" }, { status: 400 });

    newTurnPoints += scored.score;
    lockedSoFar = [...new Set([...lockedSoFar, ...holdIndices])];
  }

  const { data: player } = await supabase.from("game_match_players")
    .select("seat_index").eq("match_id", matchId).eq("wallet_address", address).single();
  const seat = player?.seat_index ?? 0;

  // ── Hot dice: all 6 held → reset to a fresh 6, keep accumulated points ──────
  const triggeredHotDice = !isFirstRoll && lockedSoFar.length >= 6;

  let fullDice: number[];
  let activeLocked: number[];     // locked indices visible on the *new* board
  let rolledIndices: number[];

  if (isFirstRoll || triggeredHotDice) {
    // Fresh roll of all 6
    fullDice      = rollDice(seed, matchId, match.turn_number, rollNumber, seat, 6);
    activeLocked  = [];
    rolledIndices = [0, 1, 2, 3, 4, 5];
  } else {
    // Roll only the non-locked positions, keep locked values in place
    rolledIndices = [0, 1, 2, 3, 4, 5].filter((i) => !lockedSoFar.includes(i));
    const freshDice = rollDice(seed, matchId, match.turn_number, rollNumber, seat, rolledIndices.length);
    fullDice = [...prevDice];
    rolledIndices.forEach((pos, idx) => { fullDice[pos] = freshDice[idx]; });
    activeLocked = lockedSoFar;
  }

  // Farkle check: do the freshly rolled dice contain any scoring die?
  const newDiceValues = rolledIndices.map((pos) => fullDice[pos]) as DiceValue[];
  const isFarkle      = !hasAnyScoringDie(newDiceValues);

  const scoringHints = isFarkle ? [] : getScoringIndices(newDiceValues).map((i) => rolledIndices[i]);

  const { error: turnError } = await supabase.from("farkle_turns").insert({
    match_id:       matchId,
    wallet_address: address,
    turn_number:    match.turn_number,
    roll_number:    rollNumber,
    dice_values:    fullDice,
    selected_dice:  activeLocked,
    turn_points:    newTurnPoints,
    banked_points:  0,
    action:         isFarkle ? "farkle" : isFirstRoll ? "roll" : "roll_again",
    farkled:        isFarkle,
    hot_dice:       triggeredHotDice,
  });
  if (turnError) {
    console.error("[farkle/roll] failed to record turn", turnError);
    return NextResponse.json(
      { error: turnError.code === "23505" ? "move already recorded" : "failed to record roll" },
      { status: turnError.code === "23505" ? 409 : 500 },
    );
  }

  const nowIso = new Date().toISOString();
  if (isFarkle) {
    const { data: players } = await supabase.from("game_match_players")
      .select("wallet_address").eq("match_id", matchId);
    const next = players?.find((p) => p.wallet_address !== address);
    const { error: matchError } = await supabase.from("game_matches").update({
      current_turn_address: next?.wallet_address,
      turn_number:          match.turn_number + 1,
      turn_started_at:      nowIso,
      last_action_at:       nowIso,
    }).eq("id", matchId);
    if (matchError) {
      console.error("[farkle/roll] failed to advance farkle turn", matchError);
      return NextResponse.json({ error: "failed to advance turn" }, { status: 500 });
    }
  } else {
    // Player still on turn — refresh the activity clock so they aren't timed out mid-turn
    const { error: matchError } = await supabase.from("game_matches").update({
      turn_started_at: nowIso,
      last_action_at:  nowIso,
    }).eq("id", matchId);
    if (matchError) {
      console.error("[farkle/roll] failed to refresh turn clock", matchError);
      return NextResponse.json({ error: "failed to refresh turn clock" }, { status: 500 });
    }
  }

  return NextResponse.json({
    dice:          fullDice,
    lockedIndices: activeLocked,
    rolledIndices,
    scoringHints,
    turnPoints:    newTurnPoints,
    rollNumber,
    isFarkle,
    isHotDice:     triggeredHotDice,
  });
}
