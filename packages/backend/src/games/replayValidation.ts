import { concat, keccak256, toUtf8Bytes } from "ethers";
import { rewardForScore, scoreMemoryFlip, scoreRuleTap } from "./score";
import type {
  GameResult,
  GameType,
  MemoryFlipReplay,
  RuleTapReplay,
} from "./types";

type Rng = () => number;
type RuleTapTileColor = "blue" | "green" | "red" | "gold";
type RuleTapTileKind = "star" | "circle" | "square" | "diamond";
type RuleTapRule = {
  targets: Array<{ color: RuleTapTileColor; kind: RuleTapTileKind }>;
};
type RuleTapTile = {
  index: number;
  color: RuleTapTileColor;
  kind: RuleTapTileKind;
  activeFromMs: number;
  activeToMs: number;
};

const RULE_TAP_DURATION_MS = 20_000;
const RULE_TAP_MIN_COMPLETION_MS = 18_000;
const RULE_TAP_MAX_ACTIONS = 120;
const MEMORY_FLIP_DURATION_MS = 60_000;
const MEMORY_FLIP_MAX_ACTIONS = 200;
const ACTION_OFFSET_TOLERANCE_MS = 250;

function hashSeed(input: string) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seed: string): Rng {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedCommitment(seed: string, walletAddress: string, gameType: GameType): string {
  return keccak256(concat([toUtf8Bytes(seed), toUtf8Bytes(walletAddress.toLowerCase()), toUtf8Bytes(gameType)]));
}

const colors = ["blue", "green", "red", "gold"] as const;
const kinds = ["star", "circle", "square", "diamond"] as const;

function generateRuleTapSession(seed: string) {
  const rng = createRng(seed);
  const target = {
    color: colors[Math.floor(rng() * colors.length)],
    kind: kinds[Math.floor(rng() * kinds.length)],
  };
  const avoid = {
    color: colors[Math.floor(rng() * colors.length)],
    kind: kinds[Math.floor(rng() * kinds.length)],
  };
  const rule: RuleTapRule = { targets: [target] };
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

function generateMemoryDeck(seed: string) {
  const rng = createRng(seed);
  const pairs = ["sun", "bolt", "leaf", "gem", "wave", "key", "moon", "spark"];
  const deck = [...pairs, ...pairs].map((value, index) => ({ id: `${value}-${index}`, value }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const TILE_WINDOW_TOLERANCE_MS = 120;

function activeTileAt(flatTimeline: RuleTapTile[], offsetMs: number, tileIndex: number) {
  return flatTimeline.find(
    (tile) =>
      tile.index === tileIndex &&
      offsetMs >= tile.activeFromMs &&
      offsetMs <= tile.activeToMs + TILE_WINDOW_TOLERANCE_MS
  );
}

function tileActivationKey(tile: RuleTapTile) {
  return `${tile.activeFromMs}:${tile.activeToMs}:${tile.index}:${tile.color}:${tile.kind}`;
}

function matchesRule(tile: RuleTapTile | undefined, rule: RuleTapRule) {
  if (!tile) return false;
  return rule.targets.some((target) => target.color === tile.color && target.kind === tile.kind);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value);
}

function validateReplayHeader(input: {
  seed: unknown;
  startedAt: unknown;
  durationMs: unknown;
  actions: unknown;
  maxDurationMs: number;
  maxActions: number;
}) {
  const flags: string[] = [];
  const durationMs = isFiniteInteger(input.durationMs) ? input.durationMs : null;

  if (typeof input.seed !== "string" || input.seed.length < 8 || input.seed.length > 256) {
    flags.push("invalid_replay_seed");
  }
  if (typeof input.startedAt !== "string" || Number.isNaN(Date.parse(input.startedAt))) {
    flags.push("invalid_started_at");
  }
  if (durationMs == null || durationMs < 0 || durationMs > input.maxDurationMs + 1_500) {
    flags.push("replay_duration_out_of_bounds");
  }
  if (!Array.isArray(input.actions)) {
    flags.push("invalid_action_log");
  } else if (input.actions.length > input.maxActions) {
    flags.push("too_many_actions");
  }

  return flags;
}

export function validateRuleTapReplay(replay: RuleTapReplay): { result: GameResult; flags: string[] } {
  const replaySeed = typeof replay.seed === "string" ? replay.seed : "";
  const replayDurationMs = isFiniteInteger(replay.durationMs) ? replay.durationMs : 0;
  const flags: string[] = validateReplayHeader({
    seed: replay.seed,
    startedAt: replay.startedAt,
    durationMs: replay.durationMs,
    actions: replay.actions,
    maxDurationMs: RULE_TAP_DURATION_MS,
    maxActions: RULE_TAP_MAX_ACTIONS,
  });
  const { rule, timeline } = generateRuleTapSession(replaySeed);
  const flatTimeline = timeline.flat();
  let correct = 0;
  let mistakes = 0;
  let previousOffset = -1;
  const intervals: number[] = [];
  const countedTargets = new Set<string>();

  for (const action of Array.isArray(replay.actions) ? replay.actions : []) {
    if (!action || action.type !== "tap") {
      flags.push("invalid_action_shape");
      continue;
    }
    if (!isFiniteInteger(action.offsetMs) || action.offsetMs < 0 || action.offsetMs > replayDurationMs + ACTION_OFFSET_TOLERANCE_MS) {
      flags.push("action_offset_out_of_bounds");
      continue;
    }
    if (!isFiniteInteger(action.tileIndex)) {
      flags.push("invalid_tile_index");
      continue;
    }
    if (action.offsetMs < 120) flags.push("reaction_time_below_120ms");
    if (action.offsetMs < previousOffset) flags.push("non_monotonic_action_log");
    if (previousOffset >= 0) intervals.push(action.offsetMs - previousOffset);
    previousOffset = action.offsetMs;
    if (action.tileIndex < 0 || action.tileIndex > 8) {
      mistakes++;
      flags.push("invalid_tile_index");
      continue;
    }
    const tile = activeTileAt(flatTimeline, action.offsetMs, action.tileIndex);
    if (matchesRule(tile, rule)) {
      const activationKey = tileActivationKey(tile!);
      if (countedTargets.has(activationKey)) {
        flags.push("duplicate_tile_activation");
        continue;
      }
      countedTargets.add(activationKey);
      correct++;
    } else {
      mistakes++;
    }
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
      completed: replayDurationMs >= RULE_TAP_MIN_COMPLETION_MS,
      elapsedMs: replayDurationMs,
      rewardMiles: reward.rewardMiles,
      rewardStable: reward.rewardStable,
      reason: correct ? undefined : "No valid targets tapped",
    },
  };
}

export function validateMemoryFlipReplay(replay: MemoryFlipReplay): { result: GameResult; flags: string[] } {
  const replaySeed = typeof replay.seed === "string" ? replay.seed : "";
  const replayDurationMs = isFiniteInteger(replay.durationMs) ? replay.durationMs : 0;
  const deck = generateMemoryDeck(replaySeed);
  const flags: string[] = validateReplayHeader({
    seed: replay.seed,
    startedAt: replay.startedAt,
    durationMs: replay.durationMs,
    actions: replay.actions,
    maxDurationMs: MEMORY_FLIP_DURATION_MS,
    maxActions: MEMORY_FLIP_MAX_ACTIONS,
  });
  const revealed = new Set<number>();
  let selected: number[] = [];
  let moves = 0;
  let matches = 0;
  let mistakes = 0;
  let lockUntil = 0;
  let previousOffset = -1;
  const intervals: number[] = [];

  for (const action of Array.isArray(replay.actions) ? replay.actions : []) {
    if (!action || action.type !== "flip") {
      flags.push("invalid_action_shape");
      continue;
    }
    if (!isFiniteInteger(action.offsetMs) || action.offsetMs < 0 || action.offsetMs > replayDurationMs + ACTION_OFFSET_TOLERANCE_MS) {
      flags.push("action_offset_out_of_bounds");
      continue;
    }
    if (!isFiniteInteger(action.cardIndex)) {
      flags.push("invalid_card_index");
      continue;
    }
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

  if (matches === 8 && replayDurationMs < 7_500) flags.push("impossible_completion_time");
  if (intervals.length >= 8 && intervals.every((interval) => interval < 170)) flags.push("sustained_machine_speed_inputs");
  if (intervals.length >= 10 && new Set(intervals.slice(-10)).size <= 2) flags.push("repeated_exact_timing_pattern");

  const completed = matches === 8;
  const score = scoreMemoryFlip({ completed, matches, moves, mistakes, elapsedMs: replayDurationMs, durationMs: 60_000 });
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
      elapsedMs: replayDurationMs,
      rewardMiles: reward.rewardMiles,
      rewardStable: reward.rewardStable,
    },
  };
}
