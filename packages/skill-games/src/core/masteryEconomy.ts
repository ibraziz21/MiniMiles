import { GAMEPLAY_CONFIGS } from "./config";
import type { GameType } from "./types";

// Mastery economy v1 (skill-games-mastery-economy-and-direct-commerce-
// cleanup-v1-spec.md §2.1-2.3, §3.1). Deliberately additive and separate
// from GAMEPLAY_CONFIGS/rewardForScore (config.ts, score.ts) — those still
// drive the live 6/9/12 economy unchanged until cutover.
//
// This module owns deterministic scoring/score-to-tier mapping only — no
// miles, no daily/monthly caps, no delta crediting. Reward *policy* (miles
// per tier, caps, delta-crediting against prior state) is a host/backend
// concern per this spec's own boundary, not a shared-package concern; see
// packages/backend/src/games/masteryEconomy.ts.
export type MasteryTier = "none" | "moderate" | "strong" | "elite";

export type ScoreBand = {
  tier: Exclude<MasteryTier, "none">;
  label: string;
  minScore: number;
};

const TIER_ORDER: Array<Exclude<MasteryTier, "none">> = ["moderate", "strong", "elite"];

// §2.1 — "Scoring stays unchanged." Derived from GAMEPLAY_CONFIGS's
// existing thresholds (the same 10/14/18 and 200/500/750 minScores that
// already drive the legacy economy) instead of hardcoding a second copy of
// those numbers — only the ordinal-position -> tier mapping is new.
export const SCORE_BANDS: Record<GameType, ScoreBand[]> = (() => {
  const bands = {} as Record<GameType, ScoreBand[]>;
  for (const gameType of Object.keys(GAMEPLAY_CONFIGS) as GameType[]) {
    const thresholds = [...GAMEPLAY_CONFIGS[gameType].thresholds].sort((a, b) => a.minScore - b.minScore);
    if (thresholds.length !== TIER_ORDER.length) {
      throw new Error(
        `SCORE_BANDS: ${gameType} has ${thresholds.length} thresholds, expected ${TIER_ORDER.length} (moderate/strong/elite)`
      );
    }
    bands[gameType] = thresholds.map((t, i) => ({ tier: TIER_ORDER[i], label: t.label, minScore: t.minScore }));
  }
  return bands;
})();

export const MASTERY_ECONOMY_V1 = {
  version: "mastery-v1",
  milesByTier: { moderate: 1, strong: 2, elite: 3 },
  attemptsPerGamePerDay: 5,
  monthlyBaseMilesCap: 60,
  timezone: "Africa/Nairobi",
} as const;

/** Pure: highest score band the score satisfies, or "none" below Moderate. */
export function scoreToTier(gameType: GameType, score: number): MasteryTier {
  const bands = [...SCORE_BANDS[gameType]].sort((a, b) => b.minScore - a.minScore);
  const achieved = bands.find((band) => score >= band.minScore);
  return achieved?.tier ?? "none";
}

export function milesForTier(tier: MasteryTier): number {
  if (tier === "none") return 0;
  return MASTERY_ECONOMY_V1.milesByTier[tier];
}
