import type { GameConfig } from "./types";

export const GAME_CONFIGS: Record<string, GameConfig> = {
  rule_tap: {
    type: "rule_tap",
    chainGameType: 1,
    name: "Rule Tap",
    shortName: "Rule Tap",
    description: "Read the rule, tap only the matching tiles, and avoid traps.",
    route: "/games/rule-tap",
    entryCostMiles: 5,
    maxRewardMiles: 12,
    maxRewardStable: 0,
    durationSeconds: 20,
    dailyPlayCap: 20,
    cooldownSeconds: 15,
    leaderboardSort: "score_desc",
    weeklyPrizeUsd: 10,
    weeklyPrizeMiles: 0,
    thresholds: [
      { label: "Warm up", minScore: 10, miles: 6,  stable: 0 },
      { label: "Sharp",   minScore: 14, miles: 9,  stable: 0 },
      { label: "Elite",   minScore: 18, miles: 12, stable: 0, note: "Top reward" },
    ],
  },
  memory_flip: {
    type: "memory_flip",
    chainGameType: 2,
    name: "Memory Flip",
    shortName: "Memory",
    description: "Match 8 hidden pairs before time runs out.",
    route: "/games/memory-flip",
    entryCostMiles: 5,
    maxRewardMiles: 12,
    maxRewardStable: 0,
    durationSeconds: 60,
    dailyPlayCap: 20,
    cooldownSeconds: 20,
    leaderboardSort: "score_desc",
    weeklyPrizeUsd: 10,
    weeklyPrizeMiles: 0,
    thresholds: [
      { label: "Memory",    minScore: 200, miles: 6,  stable: 0 },
      { label: "Sharp",     minScore: 500, miles: 9,  stable: 0 },
      { label: "Recall Pro",minScore: 750, miles: 12, stable: 0, note: "Top reward" },
    ],
  },
};

export const getGameConfig = (type: keyof typeof GAME_CONFIGS) => GAME_CONFIGS[type];

export const MOCK_WALLET = "0xAkiba000000000000000000000000000000000001";
