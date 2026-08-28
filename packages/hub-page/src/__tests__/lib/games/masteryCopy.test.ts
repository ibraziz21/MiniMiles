/**
 * Mastery economy game-UX copy
 * (skill-games-mastery-economy-and-direct-commerce-cleanup-v1-spec.md §5.2).
 * Verifies the pure copy-selection logic matches the spec's own result
 * examples, and that thresholds/economy gating never leak mastery language
 * when the backend hasn't cut over.
 */
import { describe, it, expect } from "vitest";
import { isMasteryActive, masteryThresholds, masteryResultCopy } from "@/lib/games/masteryCopy";
import type { PlayStatus, FinishResult } from "@/lib/games/clientTransport";

function status(overrides: Partial<PlayStatus> = {}): PlayStatus {
  return {
    gameType: "rule_tap",
    dailyCap: 5,
    playsToday: 1,
    playsRemaining: 4,
    nextResetAt: "2026-08-29T00:00:00.000Z",
    bestScoreToday: null,
    serviceAvailable: true,
    economyVersion: "mastery-v1",
    ...overrides,
  };
}

function finish(overrides: Partial<FinishResult> = {}): FinishResult {
  return {
    sessionId: "s1",
    accepted: true,
    score: 18,
    rewardMiles: 3,
    rewardStable: 0,
    completed: true,
    elapsedMs: 19000,
    antiAbuseFlags: [],
    reward: { mode: "offchain_ledger", status: "completed" },
    playsToday: 1,
    playsRemaining: 4,
    economyVersion: "mastery-v1",
    ...overrides,
  };
}

describe("isMasteryActive", () => {
  it("is true only when economyVersion is mastery-v1", () => {
    expect(isMasteryActive(status({ economyVersion: "mastery-v1" }))).toBe(true);
    expect(isMasteryActive(status({ economyVersion: "legacy" }))).toBe(false);
    expect(isMasteryActive(status({ economyVersion: undefined }))).toBe(false);
    expect(isMasteryActive(null)).toBe(false);
  });
});

describe("masteryThresholds", () => {
  it("returns Moderate 1 / Strong 2 / Elite 3 for rule_tap, matching unchanged score boundaries", () => {
    expect(masteryThresholds("rule_tap")).toEqual([
      { label: "Moderate", minScore: 10, miles: 1, stable: 0 },
      { label: "Strong", minScore: 14, miles: 2, stable: 0 },
      { label: "Elite", minScore: 18, miles: 3, stable: 0 },
    ]);
  });

  it("returns the same tier/miles shape for memory_flip with its own score boundaries", () => {
    expect(masteryThresholds("memory_flip")).toEqual([
      { label: "Moderate", minScore: 200, miles: 1, stable: 0 },
      { label: "Strong", minScore: 500, miles: 2, stable: 0 },
      { label: "Elite", minScore: 750, miles: 3, stable: 0 },
    ]);
  });
});

describe("masteryResultCopy — matches §5.2 examples", () => {
  it('"New best · Moderate — +1 Mile"', () => {
    const { title } = masteryResultCopy(
      finish({ tierAchieved: "moderate", previousBestTier: "none", milesCreditedThisRound: 1, rewardReason: "new_tier" })
    );
    expect(title).toBe("New best · Moderate — +1 Mile");
  });

  it('"Tier improved · Strong — +1 Mile · 2/3 earned today"', () => {
    const { title, subtitle } = masteryResultCopy(
      finish({
        tierAchieved: "strong",
        previousBestTier: "moderate",
        milesCreditedThisRound: 1,
        gameMilesToday: 2,
        rewardReason: "new_tier",
      })
    );
    expect(title).toBe("Tier improved · Strong — +1 Mile");
    expect(subtitle).toBe("2/3 earned today");
  });

  it('"Elite mastered — +3 Miles"', () => {
    const { title } = masteryResultCopy(
      finish({ tierAchieved: "elite", previousBestTier: "none", milesCreditedThisRound: 3, rewardReason: "new_tier" })
    );
    expect(title).toBe("Elite mastered — +3 Miles");
  });

  it('"Elite maintained · No extra Miles · Score submitted to leaderboard"', () => {
    const { title, subtitle } = masteryResultCopy(
      finish({ tierAchieved: "elite", previousBestTier: "elite", milesCreditedThisRound: 0, rewardReason: "tier_maintained" })
    );
    expect(title).toBe("Elite maintained · No extra Miles");
    expect(subtitle).toBe("Score submitted to leaderboard");
  });

  it('"Monthly game Miles complete · Your score still counts"', () => {
    const { title, subtitle } = masteryResultCopy(finish({ milesCreditedThisRound: 0, rewardReason: "monthly_cap" }));
    expect(title).toBe("Monthly game Miles complete");
    expect(subtitle).toBe("Your score still counts");
  });

  it('"Below Moderate · Try again · 3 attempts left"', () => {
    const { title, subtitle } = masteryResultCopy(
      finish({ tierAchieved: "none", milesCreditedThisRound: 0, rewardReason: "below_threshold", playsRemaining: 3 })
    );
    expect(title).toBe("Below Moderate · Try again");
    expect(subtitle).toBe("3 attempts left");
  });

  it("never claims a Mile was earned for a rejected round", () => {
    const { title } = masteryResultCopy(finish({ accepted: false, rewardReason: "rejected", milesCreditedThisRound: 0 }));
    expect(title.toLowerCase()).not.toMatch(/mile/);
  });
});
