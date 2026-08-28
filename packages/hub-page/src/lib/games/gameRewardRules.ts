// Single source of truth for skill-game reward/cap constants — previously
// duplicated as a literal `12`/`5` across memory-flip/page.tsx, rule-tap/
// page.tsx and api/games/status/route.ts (next-reward-progress-v1-spec.md
// §4/§14 Slice 0: "do not add a third hard-coded 12"). Now also the source
// nextReward.ts uses to compute "up to +X Miles" truthfully.
import type { GameType } from "./backendClient";

export const GAME_TYPES: GameType[] = ["rule_tap", "memory_flip"];
export const GAME_DAILY_PLAY_CAP = 5;
export const GAME_MAX_REWARD_MILES = 12;
