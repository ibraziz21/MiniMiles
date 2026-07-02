/**
 * Farkle engine — deterministic, server-authoritative.
 *
 * Scoring rules (user-defined):
 *   Single 1            = 100 pts
 *   Single 5            = 50 pts
 *   Three 1s            = 500 pts
 *   Three of any other  = 200 pts
 *   2-3-4-5-6 straight  = 400 pts  (5 dice)
 *   1-2-3-4-5-6 straight= 1000 pts (6 dice)
 */

import { createHash } from "crypto";

export type DiceValue = 1 | 2 | 3 | 4 | 5 | 6;

export interface ScoringResult {
  score:          number;
  scoringIndices: number[];  // which indices within the input array contributed
  combos:         string[];
}

// ─── Seed-based dice rolling ──────────────────────────────────────────────────

export function rollDice(
  serverSeed: string,
  matchId:    string,
  turnNumber: number,
  rollNumber: number,
  playerSeat: number,
  diceCount:  number = 6,
): DiceValue[] {
  const input = `${serverSeed}:${matchId}:t${turnNumber}:r${rollNumber}:p${playerSeat}`;
  const hash  = createHash("sha256").update(input).digest("hex");
  const dice: DiceValue[] = [];
  for (let i = 0; i < diceCount; i++) {
    const chunk = parseInt(hash.slice((i * 4) % 60, (i * 4) % 60 + 4), 16);
    dice.push(((chunk % 6) + 1) as DiceValue);
  }
  return dice;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

export function scoreDice(dice: DiceValue[]): ScoringResult {
  if (dice.length === 0) return { score: 0, scoringIndices: [], combos: [] };

  const counts = new Array(7).fill(0);
  for (const d of dice) counts[d]++;

  // ── Full-hand straights (need all specific dice) ──────────────────────────
  if (dice.length === 6) {
    // 1-2-3-4-5-6
    if (counts.slice(1).every((c) => c === 1)) {
      return { score: 1000, scoringIndices: dice.map((_, i) => i), combos: ["Straight 1–6 🎯"] };
    }
  }
  if (dice.length === 5) {
    // 2-3-4-5-6
    const sorted = [...dice].sort((a, b) => a - b);
    if (sorted.join() === "2,3,4,5,6") {
      return { score: 400, scoringIndices: dice.map((_, i) => i), combos: ["Straight 2–6"] };
    }
  }

  // ── Per-face scoring ──────────────────────────────────────────────────────
  const result: ScoringResult = { score: 0, scoringIndices: [], combos: [] };

  for (let face = 1; face <= 6; face++) {
    const c = counts[face];
    if (c === 0) continue;

    const faceIndices = dice
      .map((d, i) => (d === face ? i : -1))
      .filter((i) => i !== -1);

    if (c >= 3) {
      // Three-of-a-kind (or more — just score the first triplet)
      const pts = face === 1 ? 500 : 200;
      faceIndices.slice(0, 3).forEach((i) => result.scoringIndices.push(i));
      result.score += pts;
      result.combos.push(`Three ${face}s (${pts})`);

      // Extra dice beyond 3: score individually if 1 or 5
      const extras = faceIndices.slice(3);
      if (face === 1 && extras.length > 0) {
        extras.forEach((i) => result.scoringIndices.push(i));
        result.score += extras.length * 100;
        result.combos.push(`+${extras.length}×1 (${extras.length * 100})`);
      } else if (face === 5 && extras.length > 0) {
        extras.forEach((i) => result.scoringIndices.push(i));
        result.score += extras.length * 50;
        result.combos.push(`+${extras.length}×5 (${extras.length * 50})`);
      }
    } else if (face === 1 || face === 5) {
      const pts = face === 1 ? 100 : 50;
      faceIndices.forEach((i) => result.scoringIndices.push(i));
      result.score += pts * c;
      result.combos.push(`${c}×${face} (${pts * c})`);
    }
  }

  return result;
}

/** Score a subset of dice identified by their indices in the full array. */
export function scoreSelected(allDice: DiceValue[], selectedIndices: number[]): ScoringResult {
  const subset  = selectedIndices.map((i) => allDice[i]);
  const result  = scoreDice(subset);
  result.scoringIndices = result.scoringIndices.map((si) => selectedIndices[si]);
  return result;
}

/** Does this set of dice contain at least one scoring die? */
export function hasAnyScoringDie(dice: DiceValue[]): boolean {
  return scoreDice(dice).score > 0;
}

/** Returns indices of ALL scoring dice in the roll (for highlight hints). */
export function getScoringIndices(dice: DiceValue[]): number[] {
  return scoreDice(dice).scoringIndices;
}

// ─── Replay / result hashing ─────────────────────────────────────────────────

export interface TurnRecord {
  walletAddress: string;
  turnNumber:    number;
  rollNumber:    number;
  diceValues:    number[];
  heldIndices:   number[];
  action:        string;
  bankPoints:    number;
}

export function buildReplayHash(
  matchId:    string,
  players:    string[],
  modeKey:    string,
  serverSeed: string,
  turns:      TurnRecord[],
): string {
  const payload = JSON.stringify({ matchId, players, modeKey, serverSeed, turns });
  return createHash("sha256").update(payload).digest("hex");
}

export function buildResultHash(
  matchId:     string,
  winner:      string,
  loser:       string,
  winnerScore: number,
  loserScore:  number,
  replayHash:  string,
): string {
  const payload = JSON.stringify({ matchId, winner, loser, winnerScore, loserScore, replayHash });
  return createHash("sha256").update(payload).digest("hex");
}

export function generateServerSeed(): string {
  return createHash("sha256")
    .update(`${Date.now()}-${Math.random()}-${process.env.SERVER_SEED_SECRET ?? "akiba"}`)
    .digest("hex");
}

export function hashServerSeed(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}
