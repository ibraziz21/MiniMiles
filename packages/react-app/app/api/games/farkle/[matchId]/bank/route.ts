/**
 * POST /api/games/farkle/[matchId]/bank
 * Body: { holdIndices: number[] }
 *
 * Player selects their final scoring dice and banks all accumulated turn points.
 */
import { NextResponse } from "next/server";
import { createClient }  from "@supabase/supabase-js";
import {
  scoreSelected, buildReplayHash, buildResultHash,
  type DiceValue,
} from "@/lib/farkle/engine";
import { requireSession } from "@/lib/auth";
import { grantFarkleRewards } from "@/server/farkle/grantRewards";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
type Ctx = { params: Promise<{ matchId: string }> };

const MODE_TARGET: Record<string, number> = {
  FARKLE_QUICK_1500_AKIBA: 1500,
  FARKLE_REWARD_3000_USDT: 2500,
  FARKLE_PRO_5000_USDT: 5000,
};

function targetScoreForMode(modeKey: string | null | undefined, configuredTarget: number | null | undefined) {
  return modeKey ? MODE_TARGET[modeKey] ?? configuredTarget ?? 1500 : configuredTarget ?? 1500;
}

function normalizeHoldIndices(value: unknown): number[] | null {
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
  const body = await req.json().catch(() => null);
  const address     = session.walletAddress.toLowerCase();
  const holdIndices = normalizeHoldIndices(body?.holdIndices);

  if (!holdIndices || holdIndices.length === 0)
    return NextResponse.json({ error: "missing fields" }, { status: 400 });

  const { data: match } = await supabase.from("game_matches")
    .select("*, game_modes(target_score, winner_miles_reward, loser_miles_reward, winner_reward_credit, mode_key)")
    .eq("id", matchId).single();
  if (!match)                                 return NextResponse.json({ error: "not found" },      { status: 404 });
  if (match.status !== "in_progress")         return NextResponse.json({ error: "not active" },     { status: 400 });
  if (match.current_turn_address !== address) return NextResponse.json({ error: "not your turn" },  { status: 403 });

  const { data: rolls } = await supabase.from("farkle_turns")
    .select("*")
    .eq("match_id", matchId).eq("wallet_address", address)
    .eq("turn_number", match.turn_number)
    .order("roll_number", { ascending: false }).limit(1);

  const latest = rolls?.[0];
  if (!latest) return NextResponse.json({ error: "no roll to bank" }, { status: 400 });
  if (latest.farkled) return NextResponse.json({ error: "cannot bank after farkle" }, { status: 400 });
  if (holdIndices.some((i) => (latest.selected_dice ?? []).includes(i)))
    return NextResponse.json({ error: "already locked dice cannot be scored again" }, { status: 400 });

  const dice   = latest.dice_values as DiceValue[];
  const scored = scoreSelected(dice, holdIndices);
  if (scored.score === 0) return NextResponse.json({ error: "selected dice score 0" }, { status: 400 });
  if (scored.scoringIndices.length !== holdIndices.length)
    return NextResponse.json({ error: "selected dice include non-scoring dice" }, { status: 400 });

  const totalTurnPoints = (latest.turn_points ?? 0) + scored.score;
  const allLocked       = [...new Set([...(latest.selected_dice ?? []), ...holdIndices])];

  // Save final bank record
  const { error: turnError } = await supabase.from("farkle_turns").insert({
    match_id:       matchId,
    wallet_address: address,
    turn_number:    match.turn_number,
    roll_number:    latest.roll_number + 1,
    dice_values:    latest.dice_values,
    selected_dice:  allLocked,
    turn_points:    totalTurnPoints,
    banked_points:  totalTurnPoints,
    action:         "bank",
    farkled:        false,
    hot_dice:       false,
  });
  if (turnError) {
    console.error("[farkle/bank] failed to record bank", turnError);
    return NextResponse.json(
      { error: turnError.code === "23505" ? "move already recorded" : "failed to record bank" },
      { status: turnError.code === "23505" ? 409 : 500 },
    );
  }

  // Update player banked score
  const { data: me } = await supabase.from("game_match_players")
    .select("banked_score").eq("match_id", matchId).eq("wallet_address", address).single();
  const newBanked = (me?.banked_score ?? 0) + totalTurnPoints;

  const { error: scoreError } = await supabase.from("game_match_players")
    .update({ banked_score: newBanked })
    .eq("match_id", matchId).eq("wallet_address", address);
  if (scoreError) {
    console.error("[farkle/bank] failed to update score", scoreError);
    return NextResponse.json({ error: "failed to update score" }, { status: 500 });
  }

  const targetScore = targetScoreForMode(match.game_modes?.mode_key, match.game_modes?.target_score);

  // Check win condition
  if (newBanked >= targetScore) {
    const { data: players } = await supabase.from("game_match_players")
      .select("*").eq("match_id", matchId);
    const opp = players?.find((p) => p.wallet_address !== address);
    if (!opp?.wallet_address) {
      console.error("[farkle/bank] cannot settle match without opponent", { matchId, address });
      return NextResponse.json({ error: "match opponent missing" }, { status: 500 });
    }
    const oppScore = opp?.banked_score ?? 0;

    let settlementStatus: "settled" | "pending" = "pending";
    try {
      settlementStatus = await settle(match, address, opp.wallet_address, newBanked, oppScore, players ?? []);
    } catch (err) {
      // settle() throws only when the DB write (match completion) failed — that is
      // a real error worth surfacing. Settlement dispatch failures are caught inside
      // settle() and returned as settlementStatus:"pending".
      console.error("[farkle/bank] failed to persist match completion", { matchId, error: err });
      return NextResponse.json({ error: "failed to settle match" }, { status: 500 });
    }
    return NextResponse.json({
      bankedScore: newBanked,
      opponentScore: oppScore,
      turnPoints: totalTurnPoints,
      matchComplete: true,
      winnerId: address,
      settlementStatus,
    });
  }

  // Normal bank — switch turn
  const { data: players } = await supabase.from("game_match_players")
    .select("wallet_address").eq("match_id", matchId);
  const next = players?.find((p) => p.wallet_address !== address);
  if (!next?.wallet_address) {
    console.error("[farkle/bank] cannot advance turn without opponent", { matchId, address });
    return NextResponse.json({ error: "match opponent missing" }, { status: 500 });
  }
  const nowIso = new Date().toISOString();
  const { error: matchError } = await supabase.from("game_matches").update({
    current_turn_address: next.wallet_address,
    turn_number: match.turn_number + 1,
    turn_started_at: nowIso,
    last_action_at:  nowIso,
  }).eq("id", matchId);
  if (matchError) {
    console.error("[farkle/bank] failed to advance turn", matchError);
    return NextResponse.json({ error: "failed to advance turn" }, { status: 500 });
  }

  console.log(
    `[farkle/bank] bank matchId=${matchId} wallet=${address} turn=${match.turn_number}` +
      ` bankedScore=${newBanked} turnPoints=${totalTurnPoints} nextTurn=${next.wallet_address}`,
  );

  return NextResponse.json({ bankedScore: newBanked, turnPoints: totalTurnPoints });
}

async function settle(
  match: any, winnerAddress: string, loserAddress: string,
  winnerScore: number, loserScore: number, players: any[],
): Promise<"settled" | "pending"> {
  const modeKey   = match.game_modes?.mode_key ?? "";
  const winMiles  = match.game_modes?.winner_miles_reward ?? 10;
  const losMiles  = match.game_modes?.loser_miles_reward  ?? 5;
  const winCredit = match.game_modes?.winner_reward_credit ?? 0;

  const { data: turns } = await supabase.from("farkle_turns")
    .select("*").eq("match_id", match.id).order("turn_number,roll_number");

  // server_seed (014+) takes priority; fall back to metadata.seed for pre-014 matches.
  const seed: string = (match as any).server_seed ?? match.metadata?.seed ?? "";

  const replayHash = buildReplayHash(
    match.id,
    players.sort((a: any, b: any) => a.seat_index - b.seat_index).map((p: any) => p.wallet_address),
    modeKey, seed,
    (turns ?? []).map((t: any) => ({
      walletAddress: t.wallet_address, turnNumber: t.turn_number, rollNumber: t.roll_number,
      diceValues: t.dice_values, heldIndices: t.selected_dice,
      action: t.action, bankPoints: t.banked_points,
    }))
  );
  const resultHash = buildResultHash(match.id, winnerAddress, loserAddress, winnerScore, loserScore, replayHash);

  // Persist match result — must succeed before we attempt settlement dispatch.
  const { error: settleMatchError } = await supabase.from("game_matches").update({
    status: "completed", winner_address: winnerAddress, loser_address: loserAddress,
    winner_score: winnerScore, loser_score: loserScore,
    replay_hash: replayHash, result_hash: resultHash,
    revealed_seed: seed, completed_at: new Date().toISOString(),
  }).eq("id", match.id);
  if (settleMatchError) throw new Error(`failed to complete match: ${settleMatchError.message}`);

  const { error: winnerError } = await supabase.from("game_match_players")
    .update({ result: "win" }).eq("match_id", match.id).eq("wallet_address", winnerAddress);
  if (winnerError) throw new Error(`failed to record winner: ${winnerError.message}`);

  const { error: loserError } = await supabase.from("game_match_players")
    .update({ result: "loss" }).eq("match_id", match.id).eq("wallet_address", loserAddress);
  if (loserError) throw new Error(`failed to record loser: ${loserError.message}`);

  console.log(
    `[farkle/bank] match completed matchId=${match.id} modeKey=${modeKey}` +
    ` winner=${winnerAddress} winnerScore=${winnerScore}` +
    ` loser=${loserAddress} loserScore=${loserScore}`,
  );

  // Dispatch settlement — failure here is recoverable via reconcile.
  // The match is already marked completed; do NOT propagate this error to the player.
  try {
    await grantFarkleRewards({
      matchId: match.id, modeKey,
      winnerAddress, loserAddress, winnerScore, loserScore,
      winMiles, losMiles, winCreditCents: winCredit,
      endReason: "score",
    });
    return "settled";
  } catch (err: any) {
    console.error(
      `[farkle/bank] settlement dispatch failed matchId=${match.id} modeKey=${modeKey}` +
      ` winner=${winnerAddress} — reconcile will retry. error=${err?.message ?? err}`,
    );
    return "pending";
  }
}
