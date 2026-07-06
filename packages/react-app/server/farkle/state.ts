import { createClient } from "@supabase/supabase-js";
import type { TurnState, FarkleReactionEmoji } from "@/lib/farkle/types";
import { getScoringIndices, type DiceValue } from "@/lib/farkle/engine";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const MODE_TARGET: Record<string, number> = {
  FARKLE_QUICK_1500_AKIBA: 1500,
  FARKLE_REWARD_3000_USDT: 2500,
  FARKLE_PRO_5000_USDT: 5000,
};

type ModeRow = {
  target_score?: number | null;
  mode_key?: string | null;
};

type MatchRow = {
  id: string;
  status: string;
  current_turn_address?: string | null;
  turn_number?: number | null;
  winner_address?: string | null;
  turn_started_at?: string | null;
  game_modes?: ModeRow | ModeRow[] | null;
};

type PlayerRow = {
  wallet_address: string;
  banked_score: number | null;
};

type TurnRow = {
  dice_values: number[];
  selected_dice: number[] | null;
  turn_points: number | null;
  farkled: boolean | null;
  hot_dice: boolean | null;
};

export class FarkleStateError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

function getMode(match: MatchRow) {
  const relation = match.game_modes;
  return Array.isArray(relation) ? relation[0] : relation;
}

function targetScoreForMode(modeKey: string | null | undefined, configuredTarget: number | null | undefined) {
  return modeKey ? MODE_TARGET[modeKey] ?? configuredTarget ?? 1500 : configuredTarget ?? 1500;
}

export async function getFarkleTurnState(matchId: string, address: string): Promise<TurnState> {
  const wallet = address.toLowerCase();
  const { data: match, error } = await supabase
    .from("game_matches")
    .select("*, game_modes(target_score, winner_miles_reward, loser_miles_reward, winner_reward_credit, mode_key)")
    .eq("id", matchId)
    .single();

  if (error || !match) {
    throw new FarkleStateError("not found", 404);
  }

  const typedMatch = match as MatchRow;
  const { data: players } = await supabase
    .from("game_match_players")
    .select("*")
    .eq("match_id", matchId);

  const typedPlayers = (players ?? []) as PlayerRow[];
  const me = typedPlayers.find((p) => p.wallet_address === wallet);
  if (!me) {
    throw new FarkleStateError("not a participant in this match", 403);
  }
  const opp = typedPlayers.find((p) => p.wallet_address !== wallet);

  const activeAddress = (typedMatch.current_turn_address ?? null) as string | null;
  const isMyTurn = activeAddress === wallet;
  let currentRoll: number[] | undefined;
  let turnPoints = 0;
  let isFarkle = false;
  let isHotDice = false;
  let lockedIndices: number[] = [];
  let rolledIndices: number[] = [];
  let scoringHints: number[] = [];

  if (activeAddress && typedMatch.status === "in_progress") {
    const { data: latestRolls } = await supabase
      .from("farkle_turns")
      .select("*")
      .eq("match_id", matchId)
      .eq("wallet_address", activeAddress)
      .eq("turn_number", typedMatch.turn_number)
      .order("roll_number", { ascending: false })
      .limit(1);

    const latest = latestRolls?.[0] as TurnRow | undefined;
    if (latest) {
      currentRoll = latest.dice_values;
      turnPoints = latest.turn_points ?? 0;
      isFarkle = Boolean(latest.farkled);
      isHotDice = Boolean(latest.hot_dice);
      lockedIndices = latest.selected_dice ?? [];
      rolledIndices = [0, 1, 2, 3, 4, 5].filter((i) => !lockedIndices.includes(i));
      const rolledDice = rolledIndices.map((i) => currentRoll?.[i]).filter(Boolean) as DiceValue[];
      scoringHints = isFarkle
        ? []
        : getScoringIndices(rolledDice).map((i) => rolledIndices[i]);
    }
  }

  const { data: reactionRows } = await supabase
    .from("farkle_reactions")
    .select("id, emoji, wallet_address, created_at")
    .eq("match_id", matchId)
    .order("created_at", { ascending: false })
    .limit(1);

  const latestReaction = reactionRows?.[0] as
    | { id: string; emoji: string; wallet_address: string; created_at: string }
    | undefined;

  const usernameMap: Record<string, string> = {};
  const wallets = [wallet, opp?.wallet_address].filter(Boolean) as string[];
  if (wallets.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("user_address, username")
      .in("user_address", wallets);
    for (const user of users ?? []) {
      if (user.username) usernameMap[String(user.user_address).toLowerCase()] = user.username;
    }
  }

  const mode = getMode(typedMatch);
  return {
    matchId,
    yourUserId: wallet,
    opponentUserId: opp?.wallet_address ?? null,
    yourUsername: usernameMap[wallet] ?? null,
    opponentUsername: opp?.wallet_address ? usernameMap[opp.wallet_address] ?? null : null,
    yourScore: me?.banked_score ?? 0,
    opponentScore: opp?.banked_score ?? 0,
    isYourTurn: isMyTurn,
    currentRoll,
    lockedIndices,
    rolledIndices,
    scoringHints,
    turnPoints,
    remainingDice: Math.max(0, 6 - lockedIndices.length),
    canRoll: isMyTurn && !isFarkle && typedMatch.status === "in_progress",
    canBank: isMyTurn && turnPoints > 0 && !isFarkle && typedMatch.status === "in_progress",
    isFarkle,
    isHotDice,
    targetScore: targetScoreForMode(mode?.mode_key, mode?.target_score),
    matchStatus: typedMatch.status as TurnState["matchStatus"],
    winnerUserId: typedMatch.winner_address ?? null,
    turnStartedAt: typedMatch.turn_started_at ?? null,
    turnTimeoutSeconds: 60,
    lastReaction: latestReaction
      ? {
          id: latestReaction.id,
          emoji: latestReaction.emoji as FarkleReactionEmoji,
          fromUserId: latestReaction.wallet_address,
          sentAt: latestReaction.created_at,
        }
      : null,
  };
}
