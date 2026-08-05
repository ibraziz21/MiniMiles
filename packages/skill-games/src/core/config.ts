import type { GameplayConfig, GameType } from "./types";

// Gameplay-only config: name, duration, scoring thresholds. Deliberately does
// NOT include entry cost, daily cap, cooldown, or weekly prize fields — those
// are economy policy and belong to each host's own adapter config:
//
//   React adapter -> contract tickets and its existing daily cap
//   Pass adapter  -> free entry and daily cap 5
//
// Changing one host's economy must never silently change another host's.
export const GAMEPLAY_CONFIGS: Record<GameType, GameplayConfig> = {
  rule_tap: {
    type: "rule_tap",
    name: "Rule Tap",
    shortName: "Rule Tap",
    description: "Read the rule, tap only the matching tiles, and avoid traps.",
    durationSeconds: 20,
    leaderboardSort: "score_desc",
    thresholds: [
      { label: "Warm up", minScore: 10, miles: 6, stable: 0 },
      { label: "Sharp", minScore: 14, miles: 9, stable: 0 },
      { label: "Elite", minScore: 18, miles: 12, stable: 0, note: "Top reward" },
    ],
  },
  memory_flip: {
    type: "memory_flip",
    name: "Memory Flip",
    shortName: "Memory",
    description: "Match 8 hidden pairs before time runs out.",
    durationSeconds: 60,
    leaderboardSort: "score_desc",
    thresholds: [
      { label: "Memory", minScore: 200, miles: 6, stable: 0 },
      { label: "Sharp", minScore: 500, miles: 9, stable: 0 },
      { label: "Recall Pro", minScore: 750, miles: 12, stable: 0, note: "Top reward" },
    ],
  },
};

export const getGameplayConfig = (type: GameType) => GAMEPLAY_CONFIGS[type];
