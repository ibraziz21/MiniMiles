/**
 * GET /api/games/farkle/[matchId]/verify
 * Header: Authorization: Bearer ${CRON_SECRET}
 *
 * Admin-only replay integrity check.
 * Recomputes replay_hash and result_hash from the stored turn sequence and
 * revealed_seed, then compares them to the values committed at match completion.
 *
 * Returns:
 *   { ok, matchId, replayHashMatch, resultHashMatch, recomputedReplayHash,
 *     storedReplayHash, recomputedResultHash, storedResultHash, turnCount }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { buildReplayHash, buildResultHash } from "@/lib/farkle/engine";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const CRON_SECRET = process.env.CRON_SECRET ?? "";

type Ctx = { params: Promise<{ matchId: string }> };

function isAuthorized(req: Request): boolean {
  if (!CRON_SECRET) return false;
  return (req.headers.get("authorization") ?? "") === `Bearer ${CRON_SECRET}`;
}

export async function GET(req: Request, { params }: Ctx) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { matchId } = await params;

  // Load match — must be completed so revealed_seed is available
  const { data: match, error: matchError } = await supabase
    .from("game_matches")
    .select("id, status, winner_address, loser_address, winner_score, loser_score, replay_hash, result_hash, revealed_seed, server_seed, metadata, seed_hash, game_modes(mode_key)")
    .eq("id", matchId)
    .single();

  if (matchError || !match) {
    return NextResponse.json({ error: "match not found" }, { status: 404 });
  }
  if (match.status !== "completed") {
    return NextResponse.json({ error: "match is not completed" }, { status: 400 });
  }

  // Determine the seed used for this match (new column takes priority)
  const seed: string = match.revealed_seed ?? (match as any).server_seed ?? match.metadata?.seed ?? "";
  const modeKey: string = (match.game_modes as any)?.mode_key ?? "";

  if (!seed) {
    return NextResponse.json(
      { error: "no seed available for verification (revealed_seed is null)" },
      { status: 422 },
    );
  }

  // Load players in seat order
  const { data: players } = await supabase
    .from("game_match_players")
    .select("wallet_address, seat_index")
    .eq("match_id", matchId)
    .order("seat_index", { ascending: true });

  // Load all turns in chronological order
  const { data: turns } = await supabase
    .from("farkle_turns")
    .select("wallet_address, turn_number, roll_number, dice_values, selected_dice, action, banked_points")
    .eq("match_id", matchId)
    .order("turn_number", { ascending: true })
    .order("roll_number", { ascending: true });

  const playerAddresses = (players ?? []).map((p: any) => p.wallet_address as string);
  const turnRecords = (turns ?? []).map((t: any) => ({
    walletAddress: t.wallet_address as string,
    turnNumber:    t.turn_number    as number,
    rollNumber:    t.roll_number    as number,
    diceValues:    t.dice_values    as number[],
    heldIndices:   t.selected_dice  as number[],
    action:        t.action         as string,
    bankPoints:    t.banked_points  as number,
  }));

  // Recompute hashes
  const recomputedReplayHash = buildReplayHash(matchId, playerAddresses, modeKey, seed, turnRecords);
  const recomputedResultHash = buildResultHash(
    matchId,
    match.winner_address ?? "",
    match.loser_address  ?? "",
    match.winner_score   ?? 0,
    match.loser_score    ?? 0,
    recomputedReplayHash,
  );

  const replayHashMatch  = recomputedReplayHash === match.replay_hash;
  const resultHashMatch  = recomputedResultHash === match.result_hash;
  const ok               = replayHashMatch && resultHashMatch;

  console.log(
    `[farkle/verify] matchId=${matchId} ok=${ok}` +
      ` replayHashMatch=${replayHashMatch} resultHashMatch=${resultHashMatch}` +
      ` turnCount=${turnRecords.length} modeKey=${modeKey}`,
  );

  return NextResponse.json({
    ok,
    matchId,
    modeKey,
    replayHashMatch,
    resultHashMatch,
    recomputedReplayHash,
    storedReplayHash: match.replay_hash,
    recomputedResultHash,
    storedResultHash: match.result_hash,
    turnCount: turnRecords.length,
    playerCount: playerAddresses.length,
    seedSource: match.revealed_seed
      ? "revealed_seed"
      : (match as any).server_seed
      ? "server_seed"
      : "metadata",
  });
}
