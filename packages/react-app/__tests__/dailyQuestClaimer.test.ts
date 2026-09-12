import { describe, expect, it } from "vitest";
import {
  claimDateForTimestamp,
  dayNonceForTimestamp,
  deadlineForDayNonce,
  getDailyClaimDomain,
  getUtcDayContext,
  pointsToAmountWei,
  QUEST_CLAIM_EIP712_TYPES,
  CELO_CHAIN_ID,
} from "@/lib/dailyQuestClaimer";

describe("dailyQuestClaimer — UTC day nonce/deadline math", () => {
  it("computes the same dayNonce for any timestamp within a UTC day", () => {
    const startOfDay = Date.UTC(2026, 8, 12, 0, 0, 0) / 1000;
    const midDay = Date.UTC(2026, 8, 12, 12, 30, 0) / 1000;
    const endOfDay = Date.UTC(2026, 8, 12, 23, 59, 59) / 1000;

    const nonce = dayNonceForTimestamp(startOfDay);
    expect(dayNonceForTimestamp(midDay)).toBe(nonce);
    expect(dayNonceForTimestamp(endOfDay)).toBe(nonce);
  });

  it("rolls the dayNonce forward exactly at the midnight UTC boundary", () => {
    const lastSecondOfDay = Date.UTC(2026, 8, 12, 23, 59, 59) / 1000;
    const firstSecondOfNextDay = Date.UTC(2026, 8, 13, 0, 0, 0) / 1000;

    expect(dayNonceForTimestamp(firstSecondOfNextDay)).toBe(
      dayNonceForTimestamp(lastSecondOfDay) + 1n,
    );
  });

  it("sets the deadline to the final second of the UTC day", () => {
    const nonce = dayNonceForTimestamp(Date.UTC(2026, 8, 12, 0, 0, 0) / 1000);
    const deadline = deadlineForDayNonce(nonce);
    const deadlineDate = new Date(Number(deadline) * 1000);

    expect(deadlineDate.toISOString()).toBe("2026-09-12T23:59:59.000Z");
  });

  it("derives claim_date as the UTC calendar date", () => {
    expect(claimDateForTimestamp(Date.UTC(2026, 8, 12, 23, 59, 59) / 1000)).toBe("2026-09-12");
    expect(claimDateForTimestamp(Date.UTC(2026, 8, 13, 0, 0, 0) / 1000)).toBe("2026-09-13");
  });

  it("getUtcDayContext agrees claim_date, dayNonce and deadline for a fixed instant", () => {
    const now = new Date("2026-09-12T15:04:05.000Z");
    const ctx = getUtcDayContext(now);
    expect(ctx.claimDate).toBe("2026-09-12");
    expect(ctx.deadline).toBe(deadlineForDayNonce(ctx.dayNonce));
    expect(new Date(Number(ctx.deadline) * 1000).toISOString()).toBe("2026-09-12T23:59:59.000Z");
  });
});

describe("dailyQuestClaimer — reward amount conversion", () => {
  it("converts points to 18-decimal wei using bigint math", () => {
    expect(pointsToAmountWei(10)).toBe(10n * 10n ** 18n);
    expect(pointsToAmountWei(15)).toBe(15000000000000000000n);
  });
});

describe("dailyQuestClaimer — EIP-712 domain/types", () => {
  it("matches the deployed contract's domain shape", () => {
    const domain = getDailyClaimDomain("0xa9e6adb52e74151553c140615a09119d501c75ce");
    expect(domain).toEqual({
      name: "DailyQuestClaimer",
      version: "1",
      chainId: CELO_CHAIN_ID,
      verifyingContract: "0xa9e6adb52e74151553c140615a09119d501c75ce",
    });
    expect(CELO_CHAIN_ID).toBe(42220);
  });

  it("declares the QuestClaim struct fields in contract order", () => {
    expect(QUEST_CLAIM_EIP712_TYPES.QuestClaim).toEqual([
      { name: "user", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "dayNonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ]);
  });
});
