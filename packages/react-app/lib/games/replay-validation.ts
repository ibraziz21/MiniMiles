/**
 * Client-safe game utilities: RNG, board generators, and seed commitment.
 *
 * validateRuleTapReplay / validateMemoryFlipReplay have been moved to
 * server/games/replay-validation.ts and must NOT be imported by client code.
 */

import { keccak256, toBytes, concat } from "viem";
import type {
  GameType,
  RuleTapRule,
  RuleTapTile,
} from "./types";

type Rng = () => number;

// FNV-1a 32-bit — used only for the game RNG, not for commitments.
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

// keccak256(seed ‖ walletAddress ‖ gameType) — 256-bit commitment stored on-chain.
export function seedCommitment(seed: string, walletAddress: string, gameType: GameType): `0x${string}` {
  return keccak256(
    concat([toBytes(seed), toBytes(walletAddress.toLowerCase()), toBytes(gameType)])
  );
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
