import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { TurnState } from "@/lib/farkle/types";
import { getScoringIndices, type DiceValue } from "@/lib/farkle/engine";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type Ctx = { params: Promise<{ matchId: string }> };

const MODE_TARGET: Record<string, number> = {
  FARKLE_QUICK_1500_AKIBA: 1500,
  FARKLE_REWARD_3000_USDT: 2500,
};

function targetScoreForMode(modeKey: string | null | undefined, configuredTarget: number | null | undefined) {
  return modeKey ? MODE_TARGET[modeKey] ?? configuredTarget ?? 1500 : configuredTarget ?? 1500;
}

export async function GET(req: Request, { params }: Ctx) {
  const { matchId } = await params;
  const address = new URL(req.url).searchParams.get("address")?.toLowerCase();
  if (!address) return NextResponse.json({ error: "missing address" }, { status: 400 });

  const { data: match, error } = await supabase
    .from("game_matches")
    .select("*, game_modes(target_score, winner_miles_reward, loser_miles_reward, winner_reward_credit, mode_key)")
    .eq("id", matchId).single();
  if (error || !match) return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: players } = await supabase
    .from("game_match_players").select("*").eq("match_id", matchId);

  const me  = players?.find((p) => p.wallet_address === address);
  const opp = players?.find((p) => p.wallet_address !== address);

  const isMyTurn = match.current_turn_address === address;
  let currentRoll: number[] | undefined;
  let turnPoints   = 0;
  let isFarkle     = false;
  let isHotDice    = false;
  let lockedIndices: number[] = [];
  let rolledIndices: number[] = [];
  let scoringHints: number[] = [];

  if (isMyTurn && match.status === "in_progress") {
    const { data: latestRolls } = await supabase
      .from("farkle_turns").select("*")
      .eq("match_id", matchId).eq("wallet_address", address)
      .eq("turn_number", match.turn_number)
      .order("roll_number", { ascending: false }).limit(1);

    const latest = latestRolls?.[0];
    if (latest) {
      currentRoll = latest.dice_values;
      turnPoints  = latest.turn_points;
      isFarkle    = latest.farkled;
      isHotDice   = latest.hot_dice;
      lockedIndices = latest.selected_dice ?? [];
      rolledIndices = [0, 1, 2, 3, 4, 5].filter((i) => !lockedIndices.includes(i));
      const rolledDice = rolledIndices.map((i) => currentRoll?.[i]).filter(Boolean) as DiceValue[];
      scoringHints = isFarkle
        ? []
        : getScoringIndices(rolledDice).map((i) => rolledIndices[i]);
    }
  }

  const state: TurnState = {
    matchId,
    yourUserId:    address,
    yourScore:     me?.banked_score ?? 0,
    opponentScore: opp?.banked_score ?? 0,
    isYourTurn:    isMyTurn,
    currentRoll,
    lockedIndices,
    rolledIndices,
    scoringHints,
    turnPoints,
    remainingDice: Math.max(0, 6 - lockedIndices.length),
    canRoll:       isMyTurn && !isFarkle && match.status === "in_progress",
    canBank:       isMyTurn && turnPoints > 0 && !isFarkle && match.status === "in_progress",
    isFarkle,
    isHotDice,
    targetScore:   targetScoreForMode(match.game_modes?.mode_key, match.game_modes?.target_score),
    matchStatus:   match.status,
    winnerUserId:  match.winner_address,
    turnStartedAt: match.turn_started_at ?? null,
    turnTimeoutSeconds: 60,
  };

  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
