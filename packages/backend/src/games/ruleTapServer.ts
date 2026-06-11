import { rewardForScore, scoreRuleTap } from "./score";

/**
 * Server-authoritative Rule Tap engine.
 *
 * Rule Tap is a reaction game: the player must *see* the tiles to act, so we
 * can't hide the board like Memory Flip. Instead the full timeline is generated
 * from a high-entropy server seed and kept server-side. Tiles are revealed only
 * just-in-time (see revealedTiles) with a tiny lookahead, so a modified client
 * can never read the whole timeline ahead of time and script a perfect run
 * offline. Taps are submitted live and stamped on the server clock, so all
 * scoring + timing heuristics run on trustworthy data.
 *
 * Residual: a bot reacting to the live reveal stream is faster than a human.
 * That is the irreducible limit of any reaction game and is bounded by the
 * on-chain daily play cap + entry fee, not by these heuristics.
 *
 * This module is pure: no I/O.
 */

const COLORS = ["blue", "green", "red", "gold"] as const;
const KINDS = ["star", "circle", "square", "diamond"] as const;
type Color = (typeof COLORS)[number];
type Kind = (typeof KINDS)[number];

export const RULE_TAP_DURATION_MS = 20_000;
export const RULE_TAP_MIN_COMPLETION_MS = 18_000;
export const RULE_TAP_TICK_MS = 500;
export const RULE_TAP_GRID_SIZE = 9;
// How far ahead of activation a tile may be revealed. Small enough that it gives
// no meaningful offline-precompute advantage, large enough to render smoothly.
export const RULE_TAP_REVEAL_LEAD_MS = 250;
const TILE_ACTIVE_MS = 850;
const TILE_WINDOW_TOLERANCE_MS = 120;
// Slack for a live tap's server-arrival time vs. the tile's active window.
const TAP_ARRIVAL_TOLERANCE_MS = 250;
const MIN_INTER_TAP_MS = 90;
// How far before the server's own elapsed time a client may claim it tapped.
// This absorbs the network round-trip (so legit taps aren't judged late) while
// still preventing a client from claiming a tile that hasn't been revealed yet.
const CLIENT_OFFSET_TOLERANCE_MS = 500;

export type RuleTapTile = {
  id: string;
  index: number;
  color: Color;
  kind: Kind;
  activeFromMs: number;
  activeToMs: number;
};

export type RuleTapRule = {
  target: { color: Color; kind: Kind };
  avoid: { color: Color; kind: Kind };
};

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
 * Deterministic rule + timeline from the server seed. Reproducible from the
 * revealed seed after the game for provable fairness. Mirrors the difficulty
 * curve of the original client generator.
 */
export function buildRuleTapSession(serverSeed: string): { rule: RuleTapRule; timeline: RuleTapTile[][] } {
  const rng = createRng(serverSeed);
  const target = {
    color: COLORS[Math.floor(rng() * COLORS.length)],
    kind: KINDS[Math.floor(rng() * KINDS.length)],
  };
  const avoid = {
    color: COLORS[Math.floor(rng() * COLORS.length)],
    kind: KINDS[Math.floor(rng() * KINDS.length)],
  };
  const timeline: RuleTapTile[][] = [];
  for (let tick = 0; tick < 40; tick++) {
    const activeCount = 1 + Math.floor(rng() * 3);
    const used = new Set<number>();
    const tiles: RuleTapTile[] = [];
    for (let i = 0; i < activeCount; i++) {
      let index = Math.floor(rng() * RULE_TAP_GRID_SIZE);
      while (used.has(index)) index = Math.floor(rng() * RULE_TAP_GRID_SIZE);
      used.add(index);
      const forceTarget = rng() > 0.56;
      const forceAvoid = !forceTarget && rng() > 0.72;
      const color = forceTarget ? target.color : forceAvoid ? avoid.color : COLORS[Math.floor(rng() * COLORS.length)];
      const kind = forceTarget ? target.kind : forceAvoid ? avoid.kind : KINDS[Math.floor(rng() * KINDS.length)];
      const activeFromMs = tick * RULE_TAP_TICK_MS;
      tiles.push({
        id: `${tick}-${index}`,
        index,
        color,
        kind,
        activeFromMs,
        activeToMs: activeFromMs + TILE_ACTIVE_MS,
      });
    }
    timeline.push(tiles);
  }
  return { rule: { target, avoid }, timeline };
}

/** Tiles whose activation time has arrived (plus the small render lead). */
export function revealedTiles(timeline: RuleTapTile[][], uptoOffsetMs: number): RuleTapTile[] {
  return timeline.flat().filter((tile) => tile.activeFromMs <= uptoOffsetMs);
}

function activationKey(tile: RuleTapTile): string {
  return `${tile.activeFromMs}:${tile.activeToMs}:${tile.index}:${tile.color}:${tile.kind}`;
}

function matchesRule(tile: RuleTapTile | undefined, rule: RuleTapRule): tile is RuleTapTile {
  if (!tile) return false;
  return tile.color === rule.target.color && tile.kind === rule.target.kind;
}

function tileActiveAt(timeline: RuleTapTile[][], offsetMs: number, index: number): RuleTapTile | undefined {
  return timeline
    .flat()
    .find(
      (tile) =>
        tile.index === index &&
        offsetMs >= tile.activeFromMs &&
        offsetMs <= tile.activeToMs + TILE_WINDOW_TOLERANCE_MS
    );
}

export type RuleTapState = {
  rule: RuleTapRule;
  timeline: RuleTapTile[][];
  correct: number;
  mistakes: number;
  taps: number;
  countedTargets: string[];
  actionOffsets: number[];
  startedAtMs: number;
};

export type TapResult =
  | { ok: false; reason: string }
  | { ok: true; hit: boolean; duplicate: boolean; correct: number; mistakes: number };

/**
 * Apply a live tap at server time `nowMs`. `clientOffsetMs` is the elapsed time
 * the client believes it tapped at; we prefer it (clamped) so the network
 * round-trip doesn't push the evaluation past the tile's ~850ms window. The
 * clamp to `serverOffset + tolerance` means a client still can't claim a tile
 * that hasn't been revealed to it yet. Mutates and returns the outcome.
 */
export function applyTap(state: RuleTapState, tileIndex: number, nowMs: number, clientOffsetMs?: number): TapResult {
  const serverOffsetMs = nowMs - state.startedAtMs;
  let offsetMs = serverOffsetMs;
  if (typeof clientOffsetMs === "number" && Number.isFinite(clientOffsetMs)) {
    offsetMs = Math.max(0, Math.min(clientOffsetMs, serverOffsetMs + CLIENT_OFFSET_TOLERANCE_MS));
  }
  if (offsetMs < 0 || offsetMs > RULE_TAP_DURATION_MS + TAP_ARRIVAL_TOLERANCE_MS) {
    return { ok: false, reason: "session-expired" };
  }
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= RULE_TAP_GRID_SIZE) {
    return { ok: false, reason: "invalid-tile-index" };
  }

  state.taps += 1;
  state.actionOffsets.push(offsetMs);

  const tile = tileActiveAt(state.timeline, offsetMs, tileIndex);
  if (matchesRule(tile, state.rule)) {
    const key = activationKey(tile);
    if (state.countedTargets.includes(key)) {
      // Tapping the same active tile twice doesn't inflate the score.
      return { ok: true, hit: true, duplicate: true, correct: state.correct, mistakes: state.mistakes };
    }
    state.countedTargets.push(key);
    state.correct += 1;
    return { ok: true, hit: true, duplicate: false, correct: state.correct, mistakes: state.mistakes };
  }

  state.mistakes += 1;
  return { ok: true, hit: false, duplicate: false, correct: state.correct, mistakes: state.mistakes };
}

export type RuleTapFinalResult = {
  score: number;
  rewardMiles: number;
  rewardStable: number;
  completed: boolean;
  correct: number;
  mistakes: number;
  elapsedMs: number;
  flags: string[];
  accepted: boolean;
};

const BLOCKING_FINAL_FLAGS = ["sustained_machine_speed_inputs"];

/** Score from authoritative server state at finish time `nowMs`. */
export function finalizeRuleTap(state: RuleTapState, nowMs: number): RuleTapFinalResult {
  const elapsedMs = Math.min(RULE_TAP_DURATION_MS, Math.max(0, nowMs - state.startedAtMs));
  const completed = elapsedMs >= RULE_TAP_MIN_COMPLETION_MS;

  const flags: string[] = [];
  const intervals: number[] = [];
  for (let i = 1; i < state.actionOffsets.length; i++) {
    intervals.push(state.actionOffsets[i] - state.actionOffsets[i - 1]);
  }
  if (intervals.length >= 8 && intervals.every((gap) => gap < MIN_INTER_TAP_MS)) {
    flags.push("sustained_machine_speed_inputs");
  }
  if (intervals.length >= 8 && new Set(intervals.slice(-8)).size <= 2) {
    flags.push("repeated_exact_timing_pattern");
  }

  const score = scoreRuleTap(state.correct, state.mistakes);
  const accepted = !flags.some((flag) => BLOCKING_FINAL_FLAGS.includes(flag));
  const reward = rewardForScore("rule_tap", score);

  return {
    score,
    rewardMiles: accepted ? reward.rewardMiles : 0,
    rewardStable: accepted ? reward.rewardStable : 0,
    completed,
    correct: state.correct,
    mistakes: state.mistakes,
    elapsedMs,
    flags,
    accepted,
  };
}
