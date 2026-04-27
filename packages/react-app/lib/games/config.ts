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
    maxRewardMiles: 35,
    maxRewardStable: 0.25,
    durationSeconds: 20,
    dailyPlayCap: 20,
    cooldownSeconds: 15,
    leaderboardSort: "score_desc",
    // Weekly prize pool — set to 0 to disable; update each week to activate
    weeklyPrizeUsd: 5,
    weeklyPrizeMiles: 0,
    thresholds: [
      { label: "Warm up", minScore: 10, miles: 8, stable: 0 },
      { label: "Sharp",   minScore: 14, miles: 18, stable: 0 },
      { label: "Elite",   minScore: 18, miles: 35, stable: 0.25, note: "Stable bonus eligible" },
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
    maxRewardMiles: 20,
    maxRewardStable: 0,
    durationSeconds: 60,
    dailyPlayCap: 15,
    cooldownSeconds: 20,
    leaderboardSort: "score_desc",
    // Weekly prize pool — set to 0 to disable; update each week to activate
    weeklyPrizeUsd: 0,
    weeklyPrizeMiles: 50,
    thresholds: [
      // Score range: ~180 (3 pairs partial) → ~1040 (perfect run)
      // Typical complete run: 600-800. Partial (≥3 pairs): 180+
      { label: "Memory",    minScore: 200, miles: 10, stable: 0 },
      { label: "Sharp",     minScore: 500, miles: 15, stable: 0 },
      { label: "Recall Pro",minScore: 750, miles: 20, stable: 0, note: "Top tier" },
    ],
  },
};

export const getGameConfig = (type: keyof typeof GAME_CONFIGS) => GAME_CONFIGS[type];

export const MOCK_WALLET = "0xAkiba000000000000000000000000000000000001";
