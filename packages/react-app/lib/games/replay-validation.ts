import { scoreMemoryFlip, scoreRuleTap, rewardForScore } from "./score";
import type {
  GameResult,
  GameType,
  MemoryFlipReplay,
  RuleTapReplay,
  RuleTapRule,
  RuleTapTile,
} from "./types";

type Rng = () => number;

function hashSeed(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed: string): Rng {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedCommitment(seed: string, walletAddress: string, gameType: GameType) {
  return `0x${hashSeed(`${seed}:${walletAddress.toLowerCase()}:${gameType}`).toString(16).padStart(64, "0")}`;
}

const colors = ["blue", "green", "red", "gold"] as const;
const kinds = ["star", "circle", "square", "diamond"] as const;

export function generateRuleTapSession(seed: string) {
  const rng = createRng(seed);
  const target = {
    color: colors[Math.floor(rng() * colors.length)],
    kind: kinds[Math.floor(rng() * kinds.length)],
  };
  const avoid = {
    color: colors[Math.floor(rng() * colors.length)],
    kind: kinds[Math.floor(rng() * kinds.length)],
  };
  const rule: RuleTapRule = {
    instruction:
      target.color === avoid.color
        ? `Tap only ${target.color} ${target.kind}s`
        : `Tap ${target.color} ${target.kind}s, avoid ${avoid.color} ${avoid.kind}s`,
    targets: [target],
    avoids: [avoid],
  };
  const timeline: RuleTapTile[][] = [];
  for (let tick = 0; tick < 40; tick++) {
    const activeCount = 1 + Math.floor(rng() * 3);
    const used = new Set<number>();
    const tiles: RuleTapTile[] = [];
    for (let i = 0; i < activeCount; i++) {
      let index = Math.floor(rng() * 9);
      while (used.has(index)) index = Math.floor(rng() * 9);
      used.add(index);
      const forceTarget = rng() > 0.56;
      const forceAvoid = !forceTarget && rng() > 0.72;
      const color = forceTarget ? target.color : forceAvoid ? avoid.color : colors[Math.floor(rng() * colors.length)];
      const kind = forceTarget ? target.kind : forceAvoid ? avoid.kind : kinds[Math.floor(rng() * kinds.length)];
      tiles.push({
        id: `${tick}-${index}-${i}`,
        index,
        color,
        kind,
        activeFromMs: tick * 500,
        activeToMs: tick * 500 + 850,
      });
    }
    timeline.push(tiles);
  }
  return { rule, timeline };
}

export function generateMemoryDeck(seed: string) {
  const rng = createRng(seed);
  const pairs = ["sun", "bolt", "leaf", "gem", "wave", "key", "moon", "spark"];
  const deck = [...pairs, ...pairs].map((value, index) => ({ id: `${value}-${index}`, value }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// Allow 120ms tolerance on tile windows to account for the 80ms polling interval
// and React render lag — a tap the player saw as valid must verify as valid.
const TILE_WINDOW_TOLERANCE_MS = 120;

function activeTileAt(seed: string, offsetMs: number, tileIndex: number) {
  const { timeline } = generateRuleTapSession(seed);
  return timeline
    .flat()
    .find(
      (tile) =>
        tile.index === tileIndex &&
        offsetMs >= tile.activeFromMs &&
        offsetMs <= tile.activeToMs + TILE_WINDOW_TOLERANCE_MS
    );
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
