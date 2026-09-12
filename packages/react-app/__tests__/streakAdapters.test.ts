import { beforeEach, describe, expect, it, vi } from "vitest";
import { getUtcDateKey, getUtcIsoWeekKey } from "@/lib/dailyQuestClaimer";
import { BALANCE_STREAK_QUEST_IDS, TOPUP_STREAK_QUEST_ID } from "@/lib/streakRegistry";

const mockBalanceAtLeast = vi.fn();
const mockPlayedGame = vi.fn();
const mockToppedUp = vi.fn();
const mockBuildSevenDayStatus = vi.fn();

vi.mock("@/helpers/walletStableBalance", () => ({
  userStableWalletBalanceAtLeastUsd: (...a: any[]) => mockBalanceAtLeast(...a),
}));
vi.mock("@/helpers/graphGames", () => ({
  userPlayedAtLeastOneGameInLast24Hrs: (...a: any[]) => mockPlayedGame(...a),
}));
vi.mock("@/helpers/graphTopupStreak", () => ({
  userToppedUpAtLeast5DollarsInLast7Days: (...a: any[]) => mockToppedUp(...a),
}));
vi.mock("@/lib/questRegistry", () => ({
  getQuest: () => ({ questId: "quest-games", points: 15, reason: "games-streak" }),
}));
vi.mock("@/lib/server/legacyMintJobGuard", () => ({
  legacyDailyIdempotencyKey: (questId: string, addr: string, scope: string) => `daily:${questId}:${addr}:${scope}`,
}));
vi.mock("@/lib/supabaseClient", () => ({ supabase: {} }));
vi.mock("@/lib/sevenDaySendStreak", () => ({
  buildSevenDaySendStreakStatus: (...a: any[]) => mockBuildSevenDayStatus(...a),
  SEVEN_DAY_STREAK_QUEST_ID: "6ddc811a-1a4d-4e57-871d-836f07486531",
}));

const { dailyBalanceStreak10Adapter, dailyBalanceStreak30Adapter, dailyBalanceStreak100Adapter } = await import(
  "@/lib/server/adapters/dailyBalanceStreakAdapter"
);
const { dailyGamesStreakAdapter } = await import("@/lib/server/adapters/dailyGamesStreakAdapter");
const { weeklyTopupStreakAdapter } = await import("@/lib/server/adapters/weeklyTopupStreakAdapter");
const { sevenDaySendStreakAdapter } = await import("@/lib/server/adapters/sevenDaySendStreakAdapter");

const session = { walletAddress: "0xabc", issuedAt: Date.now() };

beforeEach(() => {
  vi.clearAllMocks();
  mockBalanceAtLeast.mockResolvedValue(true);
  mockPlayedGame.mockResolvedValue(true);
  mockToppedUp.mockResolvedValue(true);
});

describe("dailyBalanceStreakAdapter tiers", () => {
  it.each([
    ["10", dailyBalanceStreak10Adapter, 10, 40],
    ["30", dailyBalanceStreak30Adapter, 30, 50],
    ["100", dailyBalanceStreak100Adapter, 100, 70],
  ] as const)("tier %s checks its own minUsd and awards its own fixed points", async (tier, adapter, minUsd, points) => {
    const identity = await adapter.resolveIdentity(session);
    expect(identity.questId).toBe(BALANCE_STREAK_QUEST_IDS[tier]);
    expect(identity.scopeKey).toBe(getUtcDateKey());

    const result = await adapter.verifyEligibility(session, identity);
    expect(mockBalanceAtLeast).toHaveBeenCalledWith("0xabc", minUsd);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({ basePoints: points, finalizerKind: "streak_engagement" }),
      }),
    );
  });

  it("rejects with condition-failed below the tier's threshold", async () => {
    mockBalanceAtLeast.mockResolvedValue(false);
    const identity = await dailyBalanceStreak30Adapter.resolveIdentity(session);
    const result = await dailyBalanceStreak30Adapter.verifyEligibility(session, identity);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "condition-failed" }));
  });

  it("freezes the finalizer payload's scope/scopeKey/claimedAt to the daily scope", async () => {
    const identity = await dailyBalanceStreak10Adapter.resolveIdentity(session);
    const result = await dailyBalanceStreak10Adapter.verifyEligibility(session, identity);
    expect(result.ok && result.result.finalizerPayload).toEqual({
      questId: BALANCE_STREAK_QUEST_IDS["10"],
      scope: "daily",
      scopeKey: identity.scopeKey,
      claimedAt: identity.scopeKey,
    });
  });
});

describe("dailyGamesStreakAdapter", () => {
  it("uses the streak_engagement finalizer (not the factory's default daily_engagement)", async () => {
    const identity = await dailyGamesStreakAdapter.resolveIdentity(session);
    const result = await dailyGamesStreakAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({ finalizerKind: "streak_engagement", basePoints: 15 }),
      }),
    );
  });

  it("rejects when there was no game activity", async () => {
    mockPlayedGame.mockResolvedValue(false);
    const identity = await dailyGamesStreakAdapter.resolveIdentity(session);
    const result = await dailyGamesStreakAdapter.verifyEligibility(session, identity);
    expect(result.ok).toBe(false);
  });
});

describe("weeklyTopupStreakAdapter", () => {
  it("scopes by ISO week, not by UTC date", async () => {
    const identity = await weeklyTopupStreakAdapter.resolveIdentity(session);
    expect(identity.questId).toBe(TOPUP_STREAK_QUEST_ID);
    expect(identity.scopeKey).toBe(getUtcIsoWeekKey());
    expect(identity.scopeKey).toMatch(/^\d{4}-W\d{2}$/);
  });

  it("rejects when there was no qualifying top-up", async () => {
    mockToppedUp.mockResolvedValue(false);
    const identity = await weeklyTopupStreakAdapter.resolveIdentity(session);
    const result = await weeklyTopupStreakAdapter.verifyEligibility(session, identity);
    expect(result.ok).toBe(false);
  });

  it("uses the weekly scope in its streak_engagement finalizer payload", async () => {
    const identity = await weeklyTopupStreakAdapter.resolveIdentity(session);
    const result = await weeklyTopupStreakAdapter.verifyEligibility(session, identity);
    expect(result.ok && result.result.finalizerPayload).toEqual(
      expect.objectContaining({ scope: "weekly", scopeKey: identity.scopeKey }),
    );
  });
});

describe("sevenDaySendStreakAdapter", () => {
  it("is instance-scoped and deadline-refreshable, unlike the daily/weekly families", () => {
    expect(sevenDaySendStreakAdapter.canRefreshDeadline).toBe(true);
  });

  it("anchors the scope key to the earned instance window, not to today", async () => {
    mockBuildSevenDayStatus.mockResolvedValue({
      claimable: true,
      rewardClaimed: false,
      instanceStartDate: "2026-06-15",
      instanceEndDate: "2026-06-21",
    });

    const identity = await sevenDaySendStreakAdapter.resolveIdentity(session);
    expect(identity.scopeKey).toBe("streak:2026-06-15:2026-06-21");

    // A 15-minute-from-now-style deadline, not end-of-day/end-of-week.
    const nowSec = Math.floor(Date.now() / 1000);
    expect(Number(identity.deadline)).toBeGreaterThan(nowSec);
    expect(Number(identity.deadline)).toBeLessThan(nowSec + 16 * 60);
  });

  it("falls back to a throwaway scope key when not currently claimable (never persisted, since verifyEligibility rejects first)", async () => {
    mockBuildSevenDayStatus.mockResolvedValue({
      claimable: false,
      rewardClaimed: false,
      instanceStartDate: null,
      instanceEndDate: null,
    });

    const identity = await sevenDaySendStreakAdapter.resolveIdentity(session);
    expect(identity.scopeKey).toBe(getUtcDateKey());

    const result = await sevenDaySendStreakAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "condition-failed" }));
  });

  it("reports already-claimed defensively even if somehow reached with rewardClaimed", async () => {
    mockBuildSevenDayStatus.mockResolvedValue({
      claimable: false,
      rewardClaimed: true,
      instanceStartDate: null,
      instanceEndDate: null,
    });
    const identity = await sevenDaySendStreakAdapter.resolveIdentity(session);
    const result = await sevenDaySendStreakAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "already" }));
  });

  it("uses the daily_engagement finalizer (this family never touches the streaks table)", async () => {
    mockBuildSevenDayStatus.mockResolvedValue({
      claimable: true,
      rewardClaimed: false,
      instanceStartDate: "2026-06-15",
      instanceEndDate: "2026-06-21",
    });
    const identity = await sevenDaySendStreakAdapter.resolveIdentity(session);
    const result = await sevenDaySendStreakAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({ finalizerKind: "daily_engagement", basePoints: 200 }),
      }),
    );
  });
});
