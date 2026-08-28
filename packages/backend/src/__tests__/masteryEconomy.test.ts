/**
 * Mastery economy v1 — pure engine tests
 * (skill-games-mastery-economy-and-direct-commerce-cleanup-v1-spec.md
 * §2.1-2.3, §13 "game economy" — the boundaries/progressions/cap tests that
 * apply to Slice 1's pure calculation engine, before the atomic finalize
 * wiring lands in Slice 2).
 */
import { describe, it, expect } from "vitest";
import { scoreToTier, SCORE_BANDS } from "@akiba/skill-games/core";
import {
  MASTERY_ECONOMY_V1,
  MAX_BASE_MILES_PER_GAME_PER_DAY,
  MAX_BASE_MILES_COMBINED_PER_DAY,
  milesForTier,
  computeMasteryDelta,
  applyMonthlyCap,
  computeRewardReason,
  nairobiLocalDate,
  nairobiLocalMonth,
  shadowEvaluate,
} from "../games/masteryEconomy";

describe("scoreToTier — every score boundary and below-threshold boundary (§2.1)", () => {
  it.each([
    ["rule_tap", 0, "none"],
    ["rule_tap", 9, "none"],
    ["rule_tap", 10, "moderate"],
    ["rule_tap", 13, "moderate"],
    ["rule_tap", 14, "strong"],
    ["rule_tap", 17, "strong"],
    ["rule_tap", 18, "elite"],
    ["rule_tap", 100, "elite"],
    ["memory_flip", 0, "none"],
    ["memory_flip", 199, "none"],
    ["memory_flip", 200, "moderate"],
    ["memory_flip", 499, "moderate"],
    ["memory_flip", 500, "strong"],
    ["memory_flip", 749, "strong"],
    ["memory_flip", 750, "elite"],
    ["memory_flip", 2000, "elite"],
  ] as const)("%s score %d -> %s", (gameType, score, expected) => {
    expect(scoreToTier(gameType, score)).toBe(expected);
  });

  it("exposes exactly moderate/strong/elite bands per game, matching unchanged scoring thresholds", () => {
    expect(SCORE_BANDS.rule_tap.map((b) => [b.tier, b.minScore])).toEqual([
      ["moderate", 10],
      ["strong", 14],
      ["elite", 18],
    ]);
    expect(SCORE_BANDS.memory_flip.map((b) => [b.tier, b.minScore])).toEqual([
      ["moderate", 200],
      ["strong", 500],
      ["elite", 750],
    ]);
  });
});

describe("milesForTier / economy constants (§2.2, §2.3)", () => {
  it("maps tiers to 0/1/2/3 Miles", () => {
    expect(milesForTier("none")).toBe(0);
    expect(milesForTier("moderate")).toBe(1);
    expect(milesForTier("strong")).toBe(2);
    expect(milesForTier("elite")).toBe(3);
  });

  it("caps match the spec exactly", () => {
    expect(MASTERY_ECONOMY_V1.attemptsPerGamePerDay).toBe(5);
    expect(MASTERY_ECONOMY_V1.monthlyBaseMilesCap).toBe(60);
    expect(MAX_BASE_MILES_PER_GAME_PER_DAY).toBe(3);
    expect(MAX_BASE_MILES_COMBINED_PER_DAY).toBe(6);
  });
});

describe("computeMasteryDelta — progression order, including regressions and Elite-first (§2.2)", () => {
  it("Moderate on attempt 1: +1; four later Moderate scores: +0", () => {
    const first = computeMasteryDelta({ gameType: "rule_tap", score: 10, previousBestTier: "none" });
    expect(first.baseMilesDelta).toBe(1);
    expect(first.bestTierAfter).toBe("moderate");

    const repeat = computeMasteryDelta({ gameType: "rule_tap", score: 12, previousBestTier: "moderate" });
    expect(repeat.baseMilesDelta).toBe(0);
    expect(repeat.bestTierAfter).toBe("moderate");
  });

  it("Moderate, then Strong, then Elite: +1, +1, +1", () => {
    const a = computeMasteryDelta({ gameType: "rule_tap", score: 10, previousBestTier: "none" });
    expect(a.baseMilesDelta).toBe(1);
    const b = computeMasteryDelta({ gameType: "rule_tap", score: 14, previousBestTier: a.bestTierAfter });
    expect(b.baseMilesDelta).toBe(1);
    const c = computeMasteryDelta({ gameType: "rule_tap", score: 18, previousBestTier: b.bestTierAfter });
    expect(c.baseMilesDelta).toBe(1);
    expect(c.bestTierAfter).toBe("elite");
  });

  it("Elite on attempt 1: +3; later rounds: +0", () => {
    const first = computeMasteryDelta({ gameType: "rule_tap", score: 18, previousBestTier: "none" });
    expect(first.baseMilesDelta).toBe(3);
    const later = computeMasteryDelta({ gameType: "rule_tap", score: 20, previousBestTier: first.bestTierAfter });
    expect(later.baseMilesDelta).toBe(0);
  });

  it("Strong, then Moderate, then Elite: +2, +0, +1", () => {
    const a = computeMasteryDelta({ gameType: "rule_tap", score: 14, previousBestTier: "none" });
    expect(a.baseMilesDelta).toBe(2);
    const b = computeMasteryDelta({ gameType: "rule_tap", score: 10, previousBestTier: a.bestTierAfter });
    expect(b.baseMilesDelta).toBe(0);
    expect(b.bestTierAfter).toBe("strong"); // a regression never lowers the day's best
    const c = computeMasteryDelta({ gameType: "rule_tap", score: 18, previousBestTier: b.bestTierAfter });
    expect(c.baseMilesDelta).toBe(1);
    expect(c.bestTierAfter).toBe("elite");
  });

  it("below Moderate never credits and never changes the best tier", () => {
    const result = computeMasteryDelta({ gameType: "rule_tap", score: 5, previousBestTier: "strong" });
    expect(result.tierAchieved).toBe("none");
    expect(result.baseMilesDelta).toBe(0);
    expect(result.bestTierAfter).toBe("strong");
  });
});

describe("applyMonthlyCap — remaining allowance smaller than the tier delta (§2.3, §13)", () => {
  it("credits the full delta when comfortably under the cap", () => {
    const result = applyMonthlyCap({ desiredDelta: 3, alreadyCreditedThisMonth: 10 });
    expect(result).toEqual({ creditedDelta: 3, capLimited: false });
  });

  it("partially credits when the remaining allowance is smaller than the desired delta", () => {
    const result = applyMonthlyCap({ desiredDelta: 3, alreadyCreditedThisMonth: 58 });
    expect(result).toEqual({ creditedDelta: 2, capLimited: true });
  });

  it("credits nothing once the monthly cap is already reached", () => {
    const result = applyMonthlyCap({ desiredDelta: 1, alreadyCreditedThisMonth: 60 });
    expect(result).toEqual({ creditedDelta: 0, capLimited: true });
  });

  it("never credits negative Miles even if alreadyCredited somehow exceeds the cap", () => {
    const result = applyMonthlyCap({ desiredDelta: 2, alreadyCreditedThisMonth: 65 });
    expect(result).toEqual({ creditedDelta: 0, capLimited: true });
  });
});

describe("computeRewardReason (§3.2, §5.2 UI examples)", () => {
  it("rejected overrides everything else", () => {
    expect(computeRewardReason({ accepted: false, tierAchieved: "elite", desiredDelta: 3, creditedDelta: 3 })).toBe(
      "rejected"
    );
  });

  it("below_threshold when this round's own score misses Moderate", () => {
    expect(computeRewardReason({ accepted: true, tierAchieved: "none", desiredDelta: 0, creditedDelta: 0 })).toBe(
      "below_threshold"
    );
  });

  it("tier_maintained — Elite maintained, no extra Miles, still ranked", () => {
    expect(computeRewardReason({ accepted: true, tierAchieved: "elite", desiredDelta: 0, creditedDelta: 0 })).toBe(
      "tier_maintained"
    );
  });

  it("monthly_cap — desired delta fully blocked by the remaining monthly allowance", () => {
    expect(computeRewardReason({ accepted: true, tierAchieved: "moderate", desiredDelta: 1, creditedDelta: 0 })).toBe(
      "monthly_cap"
    );
  });

  it("new_tier — a genuine improvement is credited, in full or in part", () => {
    expect(computeRewardReason({ accepted: true, tierAchieved: "strong", desiredDelta: 2, creditedDelta: 2 })).toBe(
      "new_tier"
    );
    expect(computeRewardReason({ accepted: true, tierAchieved: "elite", desiredDelta: 3, creditedDelta: 1 })).toBe(
      "new_tier"
    );
  });
});

describe("Africa/Nairobi day/month boundaries (§2.5, §13)", () => {
  it("a timestamp just before Nairobi midnight and just after fall on different local dates", () => {
    // 2026-08-27T20:59:59Z = 2026-08-27T23:59:59+03:00 (Nairobi)
    expect(nairobiLocalDate(new Date("2026-08-27T20:59:59.000Z"))).toBe("2026-08-27");
    // 2026-08-27T21:00:00Z = 2026-08-28T00:00:00+03:00 (Nairobi) — crossed midnight
    expect(nairobiLocalDate(new Date("2026-08-27T21:00:00.000Z"))).toBe("2026-08-28");
  });

  it("UTC midnight is still the previous Nairobi day (UTC+3 offset)", () => {
    expect(nairobiLocalDate(new Date("2026-08-28T00:00:00.000Z"))).toBe("2026-08-28");
    expect(nairobiLocalDate(new Date("2026-07-31T22:00:00.000Z"))).toBe("2026-08-01");
  });

  it("local month is the first of the Nairobi-local month", () => {
    expect(nairobiLocalMonth(new Date("2026-08-27T20:00:00.000Z"))).toBe("2026-08-01");
    expect(nairobiLocalMonth(new Date("2026-07-31T22:00:00.000Z"))).toBe("2026-08-01");
  });
});

describe("shadowEvaluate — full-round composition", () => {
  it("a rejected result never changes mastery or produces a reward (§2.2)", () => {
    const result = shadowEvaluate({
      gameType: "rule_tap",
      score: 18,
      accepted: false,
      occurredAt: new Date("2026-08-28T10:00:00.000Z"),
      previousBestTierToday: "moderate",
      baseMilesCreditedToday: 1,
      baseMilesCreditedThisMonth: 20,
    });
    expect(result.rewardReason).toBe("rejected");
    expect(result.baseMilesDelta).toBe(0);
    expect(result.bestTierAfter).toBe("moderate");
    expect(result.gameMilesTodayAfter).toBe(1);
    expect(result.gameMilesThisMonthAfter).toBe(20);
  });

  it("Elite on a fresh day with room in the monthly cap credits +3 and reports new_tier", () => {
    const result = shadowEvaluate({
      gameType: "memory_flip",
      score: 900,
      accepted: true,
      occurredAt: new Date("2026-08-28T10:00:00.000Z"),
      previousBestTierToday: "none",
      baseMilesCreditedToday: 0,
      baseMilesCreditedThisMonth: 10,
    });
    expect(result.tierAchieved).toBe("elite");
    expect(result.desiredBaseMilesDelta).toBe(3);
    expect(result.baseMilesDelta).toBe(3);
    expect(result.capLimited).toBe(false);
    expect(result.rewardReason).toBe("new_tier");
    expect(result.gameMilesTodayAfter).toBe(3);
    expect(result.gameMilesThisMonthAfter).toBe(13);
    expect(result.localDate).toBe("2026-08-28");
    expect(result.economyVersion).toBe("mastery-v1");
  });

  it("hitting the monthly cap mid-round reports monthly_cap and credits zero, but scoring still stands", () => {
    const result = shadowEvaluate({
      gameType: "rule_tap",
      score: 10,
      accepted: true,
      occurredAt: new Date("2026-08-28T10:00:00.000Z"),
      previousBestTierToday: "none",
      baseMilesCreditedToday: 0,
      baseMilesCreditedThisMonth: 60,
    });
    expect(result.tierAchieved).toBe("moderate");
    expect(result.desiredBaseMilesDelta).toBe(1);
    expect(result.baseMilesDelta).toBe(0);
    expect(result.capLimited).toBe(true);
    expect(result.rewardReason).toBe("monthly_cap");
  });
});
