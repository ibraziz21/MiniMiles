/**
 * Server-only replay validators. Never import this from client components,
 * hooks, or lib/ — it must not appear in the browser bundle.
 *
 * Client-safe generators (generateRuleTapSession, generateMemoryDeck,
 * seedCommitment) remain in lib/games/replay-validation.ts.
 */

import { generateRuleTapSession, generateMemoryDeck, seedCommitment } from "@/lib/games/replay-validation";
import { scoreMemoryFlip, scoreRuleTap, rewardForScore } from "@/lib/games/score";
import type {
  GameResult,
  GameType,
  MemoryFlipReplay,
  RuleTapReplay,
  RuleTapTile,
  RuleTapRule,
} from "@/lib/games/types";

// Re-export so callers only need one import path for server code.
export { seedCommitment };

const TILE_WINDOW_TOLERANCE_MS = 120;

function activeTileAt(seed: string, offsetMs: number, tileIndex: number) {
  const { timeline } = generateRuleTapSession(seed);
  const candidates = timeline
    .flat()
    .filter(
      (tile) =>
        tile.index === tileIndex &&
        offsetMs >= tile.activeFromMs &&
        offsetMs <= tile.activeToMs + TILE_WINDOW_TOLERANCE_MS
    );
  return candidates[candidates.length - 1];
}

function matchesRule(tile: RuleTapTile | undefined, rule: RuleTapRule) {
  if (!tile) return false;
  return rule.targets.some((target) => target.color === tile.color && target.kind === tile.kind);
}

export function validateRuleTapReplay(replay: RuleTapReplay): { result: GameResult; flags: string[] } {
  const flags: string[] = [];
  const { rule } = generateRuleTapSession(replay.seed);
  let correct = 0;
  let mistakes = 0;
  let previousOffset = -1;
  const intervals: number[] = [];

  for (const action of replay.actions) {
    if (action.offsetMs < 120) flags.push("reaction_time_below_120ms");
    if (action.offsetMs < previousOffset) flags.push("non_monotonic_action_log");
    if (previousOffset >= 0) intervals.push(action.offsetMs - previousOffset);
    previousOffset = action.offsetMs;
    if (action.tileIndex < 0 || action.tileIndex > 8) {
      mistakes++;
      flags.push("invalid_tile_index");
      continue;
    }
    const tile = activeTileAt(replay.seed, action.offsetMs, action.tileIndex);
    if (matchesRule(tile, rule)) correct++;
    else mistakes++;
  }

  if (intervals.length >= 6 && new Set(intervals.slice(-8)).size <= 2) {
    flags.push("repeated_exact_timing_pattern");
  }

  const score = scoreRuleTap(correct, mistakes);
  const reward = rewardForScore("rule_tap", score);
  return {
    flags: [...new Set(flags)],
    result: {
      sessionId: replay.sessionId,
      gameType: "rule_tap",
      score,
      mistakes,
      completed: replay.durationMs >= 18_000,
      elapsedMs: replay.durationMs,
      rewardMiles: reward.rewardMiles,
      rewardStable: reward.rewardStable,
      reason: correct ? undefined : "No valid targets tapped",
    },
  };
}

export function validateMemoryFlipReplay(replay: MemoryFlipReplay): { result: GameResult; flags: string[] } {
  const deck = generateMemoryDeck(replay.seed);
  const flags: string[] = [];
  const revealed = new Set<number>();
  let selected: number[] = [];
  let moves = 0;
  let matches = 0;
  let mistakes = 0;
  let lockUntil = 0;
  let previousOffset = -1;
  const intervals: number[] = [];

  for (const action of replay.actions) {
    if (action.offsetMs < previousOffset) flags.push("non_monotonic_action_log");
    if (previousOffset >= 0) intervals.push(action.offsetMs - previousOffset);
    previousOffset = action.offsetMs;
    if (action.offsetMs < lockUntil) {
      flags.push("input_during_pair_evaluation_lock");
      continue;
    }
    if (action.cardIndex < 0 || action.cardIndex >= deck.length || revealed.has(action.cardIndex)) {
      flags.push("invalid_or_revealed_card_flip");
      continue;
    }
    if (selected.includes(action.cardIndex)) {
      flags.push("same_card_double_flip");
      continue;
    }
    selected.push(action.cardIndex);
    if (selected.length === 2) {
      moves++;
      const [a, b] = selected;
      if (deck[a].value === deck[b].value) {
        revealed.add(a);
        revealed.add(b);
        matches++;
      } else {
        mistakes++;
        lockUntil = action.offsetMs + 520;
      }
      selected = [];
    }
  }

  if (matches === 8 && replay.durationMs < 7_500) flags.push("impossible_completion_time");
  if (intervals.length >= 8 && intervals.every((interval) => interval < 170)) flags.push("sustained_machine_speed_inputs");
  if (intervals.length >= 10 && new Set(intervals.slice(-10)).size <= 2) flags.push("repeated_exact_timing_pattern");

  const completed = matches === 8;
  const score = scoreMemoryFlip({
    completed,
    matches,
    moves,
    mistakes,
    elapsedMs: replay.durationMs,
    durationMs: 60_000,
  });
  const reward = rewardForScore("memory_flip", score);
  return {
    flags: [...new Set(flags)],
    result: {
      sessionId: replay.sessionId,
      gameType: "memory_flip",
      score,
      mistakes,
      moves,
      matches,
      completed,
      elapsedMs: replay.durationMs,
      rewardMiles: reward.rewardMiles,
      rewardStable: reward.rewardStable,
    },
  };
}
