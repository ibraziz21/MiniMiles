/**
 * Mastery economy v1 — reward *policy* engine
 * (skill-games-mastery-economy-and-direct-commerce-cleanup-v1-spec.md
 * §2.2-2.3, §3.1-3.2). Pure functions only, no I/O — the shared
 * `@akiba/skill-games` package owns score-to-tier mapping (unchanged
 * scoring, §2.1); this module owns everything downstream of that: delta
 * crediting against a member's prior best tier that day, monthly-cap
 * limiting, and the reward_reason classification, plus a `shadowEvaluate`
 * that composes all of it into one round's full result for shadow-mode
 * comparison against the live legacy economy before cutover (§10.1).
 *
 * Slice 1 (economy foundation) only: nothing here is wired into the live
 * `/session/finish` path yet (packages/backend/src/games/web2Routes.ts),
 * which still computes rewards via GAME_CONFIGS/score.ts unchanged. That
 * wiring — replacing the read-then-credit gap with one locked atomic
 * transaction — is Slice 2 ("Economy cutover", §3.3).
 */
import { MASTERY_ECONOMY_V1, scoreToTier, milesForTier, type MasteryTier } from "@akiba/skill-games/core";
import type { GameType } from "./types";

export { MASTERY_ECONOMY_V1, scoreToTier, milesForTier };
export type { MasteryTier };

// §2.3 — "Maximum base entitlement per game/day: 3 Miles" (= elite's miles
// value) and "...across the two current games/day: 6 Miles". The per-day
// cap falls out of the tier-delta math automatically (a day's credited
// total can never exceed milesForTier("elite")), so no separate clamp is
// needed — these constants exist for the status/UX response and tests.
export const MAX_BASE_MILES_PER_GAME_PER_DAY = milesForTier("elite");
export const MAX_BASE_MILES_COMBINED_PER_DAY = MAX_BASE_MILES_PER_GAME_PER_DAY * 2;

const TIER_RANK: Record<MasteryTier, number> = { none: 0, moderate: 1, strong: 2, elite: 3 };

export type RewardReason = "new_tier" | "tier_maintained" | "below_threshold" | "monthly_cap" | "rejected";

// Africa/Nairobi is a fixed UTC+3 offset with no DST — safe as plain
// arithmetic, no timezone library or mutable client setting involved
// (§2.5 "v1 does not infer a cap or reward rate from mutable client
// country settings").
const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/** YYYY-MM-DD in Africa/Nairobi local time. */
export function nairobiLocalDate(instant: Date): string {
  return new Date(instant.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-01 in Africa/Nairobi local time — matches `local_month date` (§3.2). */
export function nairobiLocalMonth(instant: Date): string {
  return `${nairobiLocalDate(instant).slice(0, 7)}-01`;
}

export type MasteryDeltaResult = {
  tierAchieved: MasteryTier;
  previousBestTier: MasteryTier;
  bestTierAfter: MasteryTier;
  /** Uncapped desired delta from this round, before the monthly allowance is applied. */
  baseMilesDelta: number;
};

/**
 * §2.2 — "Only the positive difference from the member's previous best
 * tier is credited." A rejected result must never reach this function (see
 * shadowEvaluate's short-circuit) — an accepted round's own tier can only
 * raise, never lower, the day's best.
 */
export function computeMasteryDelta(params: {
  gameType: GameType;
  score: number;
  previousBestTier: MasteryTier;
}): MasteryDeltaResult {
  const tierAchieved = scoreToTier(params.gameType, params.score);
  const bestTierAfter =
    TIER_RANK[tierAchieved] > TIER_RANK[params.previousBestTier] ? tierAchieved : params.previousBestTier;
  const baseMilesDelta = Math.max(0, milesForTier(bestTierAfter) - milesForTier(params.previousBestTier));
  return { tierAchieved, previousBestTier: params.previousBestTier, bestTierAfter, baseMilesDelta };
}

export type MonthlyCapResult = { creditedDelta: number; capLimited: boolean };

/** §2.3 — the desired delta limited by the member's remaining monthly allowance. */
export function applyMonthlyCap(params: {
  desiredDelta: number;
  alreadyCreditedThisMonth: number;
  monthlyCap?: number;
}): MonthlyCapResult {
  const cap = params.monthlyCap ?? MASTERY_ECONOMY_V1.monthlyBaseMilesCap;
  const remaining = Math.max(0, cap - params.alreadyCreditedThisMonth);
  const creditedDelta = Math.min(params.desiredDelta, remaining);
  return { creditedDelta, capLimited: creditedDelta < params.desiredDelta };
}

/**
 * §3.2 reward_reason. Partial credit (some Miles still fit under the
 * remaining monthly allowance, just not the full desired delta) is
 * reported as "new_tier" — a real improvement was credited; "monthly_cap"
 * is reserved for the case that credits nothing at all, matching §5.2's
 * "Monthly game Miles complete · Your score still counts" copy.
 */
export function computeRewardReason(params: {
  accepted: boolean;
  tierAchieved: MasteryTier;
  desiredDelta: number;
  creditedDelta: number;
}): RewardReason {
  if (!params.accepted) return "rejected";
  if (params.tierAchieved === "none") return "below_threshold";
  if (params.desiredDelta === 0) return "tier_maintained";
  if (params.creditedDelta === 0) return "monthly_cap";
  return "new_tier";
}

export type ShadowEvaluateInput = {
  gameType: GameType;
  score: number;
  accepted: boolean;
  occurredAt: Date;
  previousBestTierToday: MasteryTier;
  baseMilesCreditedToday: number;
  baseMilesCreditedThisMonth: number;
  monthlyCap?: number;
};

export type ShadowEvaluateResult = {
  economyVersion: string;
  localDate: string;
  localMonth: string;
  tierAchieved: MasteryTier;
  previousBestTier: MasteryTier;
  bestTierAfter: MasteryTier;
  /** Uncapped delta this round would want to credit. */
  desiredBaseMilesDelta: number;
  /** What mastery-v1 would actually credit after the monthly cap. */
  baseMilesDelta: number;
  capLimited: boolean;
  rewardReason: RewardReason;
  gameMilesTodayAfter: number;
  gameMilesThisMonthAfter: number;
};

/**
 * The shadow calculator (§10.1, §14 slice 1): given one round's score plus
 * the member's prior mastery-day/monthly-cap state, computes the full
 * mastery-v1 result for that round — without touching any live delivery
 * table. Intended to be run against recent/historical sessions (using
 * their real score and a state accumulator) to compare mastery-v1
 * emissions against actual legacy 6/9/12 emissions before cutover.
 */
export function shadowEvaluate(input: ShadowEvaluateInput): ShadowEvaluateResult {
  const localDate = nairobiLocalDate(input.occurredAt);
  const localMonth = nairobiLocalMonth(input.occurredAt);
  const economyVersion = MASTERY_ECONOMY_V1.version;

  if (!input.accepted) {
    return {
      economyVersion,
      localDate,
      localMonth,
      tierAchieved: "none",
      previousBestTier: input.previousBestTierToday,
      bestTierAfter: input.previousBestTierToday,
      desiredBaseMilesDelta: 0,
      baseMilesDelta: 0,
      capLimited: false,
      rewardReason: "rejected",
      gameMilesTodayAfter: input.baseMilesCreditedToday,
      gameMilesThisMonthAfter: input.baseMilesCreditedThisMonth,
    };
  }

  const delta = computeMasteryDelta({
    gameType: input.gameType,
    score: input.score,
    previousBestTier: input.previousBestTierToday,
  });
  const capped = applyMonthlyCap({
    desiredDelta: delta.baseMilesDelta,
    alreadyCreditedThisMonth: input.baseMilesCreditedThisMonth,
    monthlyCap: input.monthlyCap,
  });
  const rewardReason = computeRewardReason({
    accepted: true,
    tierAchieved: delta.tierAchieved,
    desiredDelta: delta.baseMilesDelta,
    creditedDelta: capped.creditedDelta,
  });

  return {
    economyVersion,
    localDate,
    localMonth,
    tierAchieved: delta.tierAchieved,
    previousBestTier: delta.previousBestTier,
    bestTierAfter: delta.bestTierAfter,
    desiredBaseMilesDelta: delta.baseMilesDelta,
    baseMilesDelta: capped.creditedDelta,
    capLimited: capped.capLimited,
    rewardReason,
    gameMilesTodayAfter: input.baseMilesCreditedToday + capped.creditedDelta,
    gameMilesThisMonthAfter: input.baseMilesCreditedThisMonth + capped.creditedDelta,
  };
}
