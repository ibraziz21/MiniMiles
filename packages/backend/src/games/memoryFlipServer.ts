import crypto from "crypto";
import { keccak256, toUtf8Bytes } from "ethers";
import { rewardForScore, scoreMemoryFlip } from "./score";

/**
 * Server-authoritative Memory Flip engine.
 *
 * The deck is generated from a high-entropy server seed and lives only on the
 * server. The client never receives unflipped cards — it flips one index at a
 * time and the server reveals just that card's value. Because the board is never
 * disclosed up front, knowing any seed (or the on-chain commitment) gives a
 * cheater nothing: the only way to clear the board is to actually remember cards
 * as they are revealed. All timing is measured on the server clock, so the
 * anti-bot heuristics here run on trustworthy data (unlike a client-supplied
 * replay).
 *
 * This module is pure: no I/O. Persistence + HTTP live in routes.ts.
 */

const PAIRS = ["sun", "bolt", "leaf", "gem", "wave", "key", "moon", "spark"] as const;
export const MEMORY_FLIP_CARD_COUNT = PAIRS.length * 2; // 16
export const MEMORY_FLIP_PAIR_COUNT = PAIRS.length; // 8
export const MEMORY_FLIP_DURATION_MS = 60_000;
const EVAL_LOCK_MS = 560;
// How long after the on-chain/start window we still accept flips (clock skew + latency).
export const MEMORY_FLIP_ACTION_TOLERANCE_MS = 1_500;
// Below this gap between two consecutive flips is faster than a human can act.
const MIN_INTER_FLIP_MS = 110;

export function newServerSeed(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function serverSeedHash(seed: string): string {
  return keccak256(toUtf8Bytes(seed));
}

function hashSeed(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createRng(seed: string): () => number {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic deck from the server seed. Anyone given the revealed serverSeed
 * after the game can reproduce this exact deck for provable fairness.
 */
export function buildMemoryDeck(serverSeed: string): string[] {
  const rng = createRng(serverSeed);
  const deck = [...PAIRS, ...PAIRS];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export type MemoryServerState = {
  deck: string[];
  revealed: number[]; // indices currently face up (matched cards stay face up)
  matched: number[];
  selected: number[]; // 0 or 1 pending picks for the current move
  moves: number;
  matches: number;
  mistakes: number;
  lockUntilMs: number; // offset-ms until which flips are rejected (pair flash)
  startedAtMs: number; // server epoch ms when the session was created
  actionOffsets: number[]; // server-observed offsetMs for every accepted flip
  completed: boolean;
};

export type MemoryPublicState = {
  revealed: number[];
  matched: number[];
  selected: number[];
  moves: number;
  matches: number;
  mistakes: number;
  completed: boolean;
};

export type FlipResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      value: string;
      // Present only when this flip completed a pair (the second pick).
      pair?: { a: number; b: number; matched: boolean; aValue: string; bValue: string };
      state: MemoryPublicState;
    };

export function publicState(state: MemoryServerState): MemoryPublicState {
  return {
    revealed: [...state.revealed],
    matched: [...state.matched],
    selected: [...state.selected],
    moves: state.moves,
    matches: state.matches,
    mistakes: state.mistakes,
    completed: state.completed,
  };
}

/**
 * Apply a single flip against authoritative state at server time `nowMs`.
 * Mutates and returns the state-affecting result. Rejections are returned, not
 * thrown, so callers can map them to HTTP status without losing state.
 */
export function applyFlip(state: MemoryServerState, cardIndex: number, nowMs: number): FlipResult {
  if (state.completed) return { ok: false, reason: "session-completed" };

  const offsetMs = nowMs - state.startedAtMs;
  if (offsetMs > MEMORY_FLIP_DURATION_MS + MEMORY_FLIP_ACTION_TOLERANCE_MS) {
    return { ok: false, reason: "session-expired" };
  }
  if (offsetMs < state.lockUntilMs) {
    return { ok: false, reason: "pair-evaluation-lock" };
  }
  if (!Number.isInteger(cardIndex) || cardIndex < 0 || cardIndex >= state.deck.length) {
    return { ok: false, reason: "invalid-card-index" };
  }
  if (state.matched.includes(cardIndex) || state.revealed.includes(cardIndex)) {
    return { ok: false, reason: "card-already-revealed" };
  }
  if (state.selected.includes(cardIndex)) {
    return { ok: false, reason: "same-card-double-flip" };
  }
  if (state.selected.length >= 2) {
    return { ok: false, reason: "selection-not-cleared" };
  }

  state.actionOffsets.push(offsetMs);
  state.revealed.push(cardIndex);
  state.selected.push(cardIndex);
  const value = state.deck[cardIndex];

  if (state.selected.length < 2) {
    return { ok: true, value, state: publicState(state) };
  }

  // Second pick — resolve the move.
  state.moves += 1;
  const [a, b] = state.selected;
  const aValue = state.deck[a];
  const bValue = state.deck[b];
  const matched = aValue === bValue;

  if (matched) {
    state.matched.push(a, b);
    state.matches += 1;
    if (state.matches >= MEMORY_FLIP_PAIR_COUNT) state.completed = true;
  } else {
    state.mistakes += 1;
    // Hide the two mismatched cards again and lock input for the flash window.
    state.revealed = state.revealed.filter((i) => i !== a && i !== b);
    state.lockUntilMs = offsetMs + EVAL_LOCK_MS;
  }
  state.selected = [];

  return {
    ok: true,
    value,
    pair: { a, b, matched, aValue, bValue },
    state: publicState(state),
  };
}

export type MemoryFinalResult = {
  score: number;
  rewardMiles: number;
  rewardStable: number;
  completed: boolean;
  matches: number;
  moves: number;
  mistakes: number;
  elapsedMs: number;
  flags: string[];
  accepted: boolean;
};

const BLOCKING_FINAL_FLAGS = ["impossible_completion_time", "sustained_machine_speed_inputs"];

/**
 * Score the session from authoritative server state at finish time `nowMs`.
 * Timing flags run on server-observed offsets, so they cannot be spoofed by a
 * modified client. A blocking flag zeroes the reward (score still recorded).
 */
export function finalizeMemoryFlip(state: MemoryServerState, nowMs: number): MemoryFinalResult {
  const elapsedMs = Math.min(MEMORY_FLIP_DURATION_MS, Math.max(0, nowMs - state.startedAtMs));
  const completed = state.matches >= MEMORY_FLIP_PAIR_COUNT;

  const flags: string[] = [];
  const intervals: number[] = [];
  for (let i = 1; i < state.actionOffsets.length; i++) {
    intervals.push(state.actionOffsets[i] - state.actionOffsets[i - 1]);
  }
  if (completed && elapsedMs < 7_500) flags.push("impossible_completion_time");
  if (intervals.length >= 8 && intervals.every((gap) => gap < MIN_INTER_FLIP_MS)) {
    flags.push("sustained_machine_speed_inputs");
  }
  if (intervals.length >= 10 && new Set(intervals.slice(-10)).size <= 2) {
    flags.push("repeated_exact_timing_pattern");
  }

  const score = scoreMemoryFlip({
    completed,
    matches: state.matches,
    moves: state.moves,
    mistakes: state.mistakes,
    elapsedMs,
    durationMs: MEMORY_FLIP_DURATION_MS,
  });
  const accepted = !flags.some((flag) => BLOCKING_FINAL_FLAGS.includes(flag));
  const reward = rewardForScore("memory_flip", score);

  return {
    score,
    rewardMiles: accepted ? reward.rewardMiles : 0,
    rewardStable: accepted ? reward.rewardStable : 0,
    completed,
    matches: state.matches,
    moves: state.moves,
    mistakes: state.mistakes,
    elapsedMs,
    flags,
    accepted,
  };
}
