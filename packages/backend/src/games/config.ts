import type { GameType, RewardThreshold } from "./types";

export const PER_GAME_DAILY_PLAY_CAP = 20;

export const GAME_TYPE_ID: Record<GameType, number> = {
  rule_tap: 1,
  memory_flip: 2,
  penalty_pressure: 3,
};

export const GAME_CONFIGS: Record<GameType, {
  chainGameType: number;
  thresholds: RewardThreshold[];
}> = {
  rule_tap: {
    chainGameType: 1,
    thresholds: [
      { label: "Warm up", minScore: 10, miles: 6, stable: 0 },
      { label: "Sharp", minScore: 14, miles: 9, stable: 0 },
      { label: "Elite", minScore: 18, miles: 12, stable: 0 },
    ],
  },
  memory_flip: {
    chainGameType: 2,
    thresholds: [
      { label: "Memory", minScore: 200, miles: 6, stable: 0 },
      { label: "Sharp", minScore: 500, miles: 9, stable: 0 },
      { label: "Recall Pro", minScore: 750, miles: 12, stable: 0 },
    ],
  },
  penalty_pressure: {
    chainGameType: 3,
    // minScore here represents goals scored — reward is goal-based, not score-based.
    // rewardForPenaltyGoals() handles actual payouts; these thresholds drive the
    // intro sheet display only.
    thresholds: [
      { label: "2 goals", minScore: 2, miles: 5,  stable: 0 },
      { label: "3 goals", minScore: 3, miles: 6,  stable: 0 },
      { label: "4 goals", minScore: 4, miles: 9,  stable: 0 },
      { label: "5 goals", minScore: 5, miles: 12, stable: 0 },
    ],
  },
};

export function isGameType(value: unknown): value is GameType {
  return value === "rule_tap" || value === "memory_flip" || value === "penalty_pressure";
}
