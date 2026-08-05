import { GAMEPLAY_CONFIGS } from "@akiba/skill-games/core";
import type { GameConfig } from "./types";

export const PER_GAME_DAILY_PLAY_CAP = 20;
export const SHARED_DAILY_PLAY_CAP = PER_GAME_DAILY_PLAY_CAP;
export const GAME_TYPES = ["rule_tap", "memory_flip"] as const;

// Gameplay shape (name/duration/thresholds) comes from the shared package —
// this layer adds only React's economy policy (contract tickets, daily cap,
// cooldown, weekly prize). See @akiba/skill-games §5.1.
export const GAME_CONFIGS: Record<string, GameConfig> = {
  rule_tap: {
    ...GAMEPLAY_CONFIGS.rule_tap,
    chainGameType: 1,
    route: "/games/rule-tap",
    entryCostMiles: 5,
    maxRewardMiles: 12,
    maxRewardStable: 0,
    dailyPlayCap: PER_GAME_DAILY_PLAY_CAP,
    cooldownSeconds: 15,
    weeklyPrizeUsd: 10,
    weeklyPrizeMiles: 0,
  },
  memory_flip: {
    ...GAMEPLAY_CONFIGS.memory_flip,
    chainGameType: 2,
    route: "/games/memory-flip",
    entryCostMiles: 5,
    maxRewardMiles: 12,
    maxRewardStable: 0,
    dailyPlayCap: PER_GAME_DAILY_PLAY_CAP,
    cooldownSeconds: 20,
    weeklyPrizeUsd: 10,
    weeklyPrizeMiles: 0,
  },
};

export const getGameConfig = (type: keyof typeof GAME_CONFIGS) => GAME_CONFIGS[type];

export const MOCK_WALLET = "0xAkiba000000000000000000000000000000000001";
