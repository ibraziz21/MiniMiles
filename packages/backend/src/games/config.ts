import type { GameType, RewardThreshold } from "./types";

export const PER_GAME_DAILY_PLAY_CAP = 20;

export const GAME_TYPE_ID: Record<GameType, number> = {
  rule_tap: 1,
  memory_flip: 2,
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
};

export function isGameType(value: unknown): value is GameType {
  return value === "rule_tap" || value === "memory_flip";
}
