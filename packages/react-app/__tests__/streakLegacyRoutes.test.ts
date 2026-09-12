import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSession = vi.fn();
const mockIsSelfClaimEnabledForWallet = vi.fn();
const mockClaimStreakReward = vi.fn();
const mockBalanceAtLeast = vi.fn();
const mockPlayedGame = vi.fn();
const mockToppedUp = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireSession: () => mockRequireSession(),
  logSessionAge: () => true,
}));

vi.mock("@/lib/server/dailySelfClaimMode", () => ({
  isSelfClaimEnabledForWallet: (...a: any[]) => mockIsSelfClaimEnabledForWallet(...a),
}));

vi.mock("@/helpers/streaks", () => ({
  claimStreakReward: (...a: any[]) => mockClaimStreakReward(...a),
}));

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

const { POST: balancesPOST } = await import("@/app/api/streaks/balances/route");
const { POST: gamesPOST } = await import("@/app/api/streaks/games/route");
const { POST: topupPOST } = await import("@/app/api/streaks/topup/route");

const BALANCE_10_QUEST_ID = "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f";
const BALANCE_100_QUEST_ID = "b5c7e1d2-6f8a-4b0c-9d2e-3a1f7c5b8e4d";

function jsonReq(body: unknown) {
  return new Request("http://localhost/x", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue({ walletAddress: "0xSessionWallet", issuedAt: Date.now() });
  mockIsSelfClaimEnabledForWallet.mockReturnValue(false);
  mockBalanceAtLeast.mockResolvedValue(true);
  mockPlayedGame.mockResolvedValue(true);
  mockToppedUp.mockResolvedValue(true);
  mockClaimStreakReward.mockResolvedValue({
    ok: true, points: 40, scopeKey: "2026-09-12", currentStreak: 1, longestStreak: 1,
  });
});

describe("POST /api/streaks/balances — security fixes", () => {
  it("requires an authenticated session", async () => {
    mockRequireSession.mockResolvedValueOnce(null);
    const res = await balancesPOST(jsonReq({ questId: BALANCE_10_QUEST_ID, tier: "10" }));
    expect(res.status).toBe(401);
  });

  it("derives the wallet from the session, never from request JSON", async () => {
    await balancesPOST(jsonReq({ userAddress: "0xAttackerControlled", questId: BALANCE_10_QUEST_ID, tier: "10" }));
    expect(mockBalanceAtLeast).toHaveBeenCalledWith("0xSessionWallet", 10);
    expect(mockClaimStreakReward).toHaveBeenCalledWith(
      expect.objectContaining({ userAddress: "0xSessionWallet" }),
    );
  });

  it("derives tier/minUsd/points from the registered questId, ignoring a mismatched client-supplied tier", async () => {
    // Previously: tier came straight from the client with no link to
    // questId — a client could send the $10 questId with tier:"100" and be
    // credited the $100 reward while only proving a $10 balance.
    await balancesPOST(jsonReq({ questId: BALANCE_10_QUEST_ID, tier: "100" }));

    expect(mockBalanceAtLeast).toHaveBeenCalledWith("0xSessionWallet", 10); // tier "100" ignored
    expect(mockClaimStreakReward).toHaveBeenCalledWith(expect.objectContaining({ points: 40 }));
  });

  it("returns 400 for an unregistered questId instead of trusting an arbitrary combination", async () => {
    const res = await balancesPOST(jsonReq({ questId: "not-a-real-quest-id", tier: "10" }));
    expect(res.status).toBe(400);
    expect(mockClaimStreakReward).not.toHaveBeenCalled();
  });

  it("gates the correct per-tier family when that tier is in self-claim mode", async () => {
    mockIsSelfClaimEnabledForWallet.mockImplementation((family: string) => family === "daily_balance_streak_100");

    const res10 = await balancesPOST(jsonReq({ questId: BALANCE_10_QUEST_ID }));
    expect(res10.status).not.toBe(409);

    const res100 = await balancesPOST(jsonReq({ questId: BALANCE_100_QUEST_ID }));
    const body100 = await res100.json();
    expect(res100.status).toBe(409);
    expect(body100.code).toBe("self-claim-required");
  });
});

describe("POST /api/streaks/games — security fixes", () => {
  it("requires an authenticated session", async () => {
    mockRequireSession.mockResolvedValueOnce(null);
    const res = await gamesPOST(jsonReq({}));
    expect(res.status).toBe(401);
  });

  it("derives the wallet from the session and the quest ID from the registry, not from request JSON", async () => {
    await gamesPOST(jsonReq({ userAddress: "0xAttackerControlled", questId: "0xClientSuppliedQuestId" }));
    expect(mockPlayedGame).toHaveBeenCalledWith("0xSessionWallet");
    expect(mockClaimStreakReward).toHaveBeenCalledWith(
      expect.objectContaining({ userAddress: "0xSessionWallet", questId: "quest-games" }),
    );
  });

  it("returns 409 once this family is in self-claim mode", async () => {
    mockIsSelfClaimEnabledForWallet.mockReturnValue(true);
    const res = await gamesPOST(jsonReq({}));
    expect(res.status).toBe(409);
    expect(mockClaimStreakReward).not.toHaveBeenCalled();
  });
});

describe("POST /api/streaks/topup — security fixes", () => {
  it("requires an authenticated session", async () => {
    mockRequireSession.mockResolvedValueOnce(null);
    const res = await topupPOST(jsonReq({}));
    expect(res.status).toBe(401);
  });

  it("derives the wallet from the session and the quest ID from the fixed registry", async () => {
    await topupPOST(jsonReq({ userAddress: "0xAttackerControlled", questId: "0xClientSuppliedQuestId" }));
    expect(mockToppedUp).toHaveBeenCalledWith("0xSessionWallet");
    expect(mockClaimStreakReward).toHaveBeenCalledWith(
      expect.objectContaining({
        userAddress: "0xSessionWallet",
        questId: "96009afb-0762-4399-adb3-ced421d73072",
      }),
    );
  });

  it("returns 409 once this family is in self-claim mode", async () => {
    mockIsSelfClaimEnabledForWallet.mockReturnValue(true);
    const res = await topupPOST(jsonReq({}));
    expect(res.status).toBe(409);
    expect(mockClaimStreakReward).not.toHaveBeenCalled();
  });
});
