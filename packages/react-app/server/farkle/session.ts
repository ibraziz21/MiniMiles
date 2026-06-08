import type { SupabaseClient } from "@supabase/supabase-js";

export const FARKLE_TURN_TIMEOUT_SECONDS = 60;
export const FARKLE_MATCH_STALE_SECONDS = 5 * 60;
export const FARKLE_QUEUE_TTL_MS = 120_000;

const ACTIVE_MATCH_STATUSES = ["created", "funded", "in_progress"];
const FARKLE_MODE_KEYS = new Set(["FARKLE_QUICK_1500_AKIBA", "FARKLE_REWARD_3000_USDT"]);

interface MatchRow {
  id: string;
  status: string;
  current_turn_address?: string | null;
  turn_started_at?: string | null;
  last_action_at?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  metadata?: Record<string, unknown> | null;
  game_modes?: { mode_key?: string | null } | { mode_key?: string | null }[] | null;
}

interface PlayerRow {
  match_id: string;
  wallet_address: string;
  banked_score: number | null;
}

function isOlderThan(iso: string | null | undefined, seconds: number, nowMs = Date.now()) {
  if (!iso) return false;
  const value = new Date(iso).getTime();
  return Number.isFinite(value) && nowMs - value > seconds * 1000;
}

function matchActivityIso(match: MatchRow) {
  return match.last_action_at ?? match.turn_started_at ?? match.started_at ?? match.created_at;
}

function getModeKey(match: MatchRow) {
  const relation = match.game_modes;
  return (Array.isArray(relation) ? relation[0]?.mode_key : relation?.mode_key) ?? null;
}

function isFarkleMatch(match: MatchRow) {
  const modeKey = getModeKey(match);
  return !!modeKey && FARKLE_MODE_KEYS.has(modeKey);
}

export async function expireWaitingQueue(supabase: SupabaseClient, now = new Date()) {
  const nowIso = now.toISOString();

  const { error } = await supabase
    .from("matchmaking_queue")
    .update({ status: "expired" })
    .eq("status", "waiting")
    .lt("expires_at", nowIso);
  if (error) console.error("[farkle/session] failed to expire queue", error);

  const { error: reservationError } = await supabase
    .from("matchmaking_queue")
    .update({ status: "expired" })
    .eq("status", "matched")
    .is("match_id", null)
    .lt("expires_at", nowIso);
  if (reservationError) console.error("[farkle/session] failed to expire stale reservation", reservationError);
}

async function cancelMatch(supabase: SupabaseClient, match: MatchRow, reason: string, nowIso: string) {
  const { error } = await supabase
    .from("game_matches")
    .update({
      status: "cancelled",
      completed_at: nowIso,
      metadata: { ...(match.metadata ?? {}), endReason: reason },
    })
    .eq("id", match.id)
    .in("status", ACTIVE_MATCH_STATUSES);
  if (error) console.error("[farkle/session] failed to cancel stale match", error);
}

async function completeTimeout(
  supabase: SupabaseClient,
  match: MatchRow,
  winner: PlayerRow,
  loser: PlayerRow,
  nowIso: string,
) {
  const { error: matchError } = await supabase
    .from("game_matches")
    .update({
      status: "completed",
      winner_address: winner.wallet_address,
      loser_address: loser.wallet_address,
      winner_score: winner.banked_score ?? 0,
      loser_score: loser.banked_score ?? 0,
      completed_at: nowIso,
      metadata: { ...(match.metadata ?? {}), endReason: "timeout_auto" },
    })
    .eq("id", match.id)
    .eq("status", "in_progress");
  if (matchError) {
    console.error("[farkle/session] failed to auto-timeout match", matchError);
    return;
  }

  const { error: winnerError } = await supabase
    .from("game_match_players")
    .update({ result: "win" })
    .eq("match_id", match.id)
    .eq("wallet_address", winner.wallet_address);
  const { error: loserError } = await supabase
    .from("game_match_players")
    .update({ result: "loss" })
    .eq("match_id", match.id)
    .eq("wallet_address", loser.wallet_address);
  if (winnerError || loserError) {
    console.error("[farkle/session] failed to record timeout players", winnerError ?? loserError);
  }
}

export async function reconcilePlayerFarkleSessions(supabase: SupabaseClient, address: string) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  const { data: playerRows, error: playerError } = await supabase
    .from("game_match_players")
    .select("match_id, wallet_address, banked_score")
    .eq("wallet_address", address);
  if (playerError) {
    console.error("[farkle/session] failed to read player matches", playerError);
    return;
  }

  const matchIds = [...new Set((playerRows ?? []).map((row: PlayerRow) => row.match_id))];
  if (matchIds.length === 0) return;

  const [{ data: matches, error: matchesError }, { data: allPlayers, error: allPlayersError }] =
    await Promise.all([
      supabase
        .from("game_matches")
        .select("id, status, current_turn_address, turn_started_at, last_action_at, started_at, created_at, metadata, game_modes(mode_key)")
        .in("id", matchIds)
        .in("status", ACTIVE_MATCH_STATUSES),
      supabase
        .from("game_match_players")
        .select("match_id, wallet_address, banked_score")
        .in("match_id", matchIds),
    ]);

  if (matchesError || allPlayersError) {
    console.error("[farkle/session] failed to read active session state", matchesError ?? allPlayersError);
    return;
  }

  for (const match of ((matches ?? []) as MatchRow[]).filter(isFarkleMatch)) {
    const players = ((allPlayers ?? []) as PlayerRow[]).filter((row) => row.match_id === match.id);
    const activityIso = matchActivityIso(match);

    if (players.length < 2) {
      if (isOlderThan(activityIso, FARKLE_MATCH_STALE_SECONDS, now)) {
        await cancelMatch(supabase, match, "stale_incomplete_match", nowIso);
      }
      continue;
    }

    if (isOlderThan(activityIso, FARKLE_MATCH_STALE_SECONDS, now)) {
      await cancelMatch(supabase, match, "stale_inactive_match", nowIso);
      continue;
    }

    if (
      match.status === "in_progress" &&
      match.current_turn_address &&
      isOlderThan(match.turn_started_at, FARKLE_TURN_TIMEOUT_SECONDS, now)
    ) {
      const loser = players.find((row) => row.wallet_address === match.current_turn_address);
      const winner = players.find((row) => row.wallet_address !== match.current_turn_address);
      if (winner && loser) {
        await completeTimeout(supabase, match, winner, loser, nowIso);
      } else {
        await cancelMatch(supabase, match, "invalid_timeout_players", nowIso);
      }
    }
  }
}

export async function getActiveFarkleMatchForPlayer(supabase: SupabaseClient, address: string) {
  await reconcilePlayerFarkleSessions(supabase, address);

  const { data: playerRows, error: playerError } = await supabase
    .from("game_match_players")
    .select("match_id")
    .eq("wallet_address", address);
  if (playerError) {
    console.error("[farkle/session] failed to read active player rows", playerError);
    return null;
  }

  const matchIds = [...new Set((playerRows ?? []).map((row: { match_id: string }) => row.match_id))];
  if (matchIds.length === 0) return null;

  const { data: matches, error: matchError } = await supabase
    .from("game_matches")
    .select("id, status, created_at, game_modes(mode_key)")
    .in("id", matchIds)
    .in("status", ACTIVE_MATCH_STATUSES)
    .order("created_at", { ascending: false });
  if (matchError) {
    console.error("[farkle/session] failed to read active match", matchError);
    return null;
  }

  const match = ((matches ?? []) as MatchRow[]).find(isFarkleMatch);
  if (!match) return null;
  return {
    matchId: match.id as string,
    status: match.status as string,
    modeKey: getModeKey(match),
  };
}
