import { beforeEach, describe, expect, it, vi } from "vitest";

const mockIsBlacklisted = vi.fn();
const mockGetCeloTxCount = vi.fn();

vi.mock("@/lib/blacklist", () => ({ isBlacklisted: (...a: any[]) => mockIsBlacklisted(...a) }));
vi.mock("@/lib/celoClient", () => ({ getCeloTxCount: (...a: any[]) => mockGetCeloTxCount(...a) }));
vi.mock("@/lib/questRegistry", () => ({
  getQuest: () => ({ questId: "quest-daily", points: 10, reason: "daily-engagement:quest-daily" }),
}));
vi.mock("@/lib/server/legacyMintJobGuard", () => ({
  legacyDailyIdempotencyKey: (questId: string, addr: string, scope: string) =>
    `daily:${questId}:${addr.toLowerCase()}:${scope}`,
}));

const { dailyCheckinAdapter } = await import("@/lib/server/adapters/dailyCheckinAdapter");

const session = { walletAddress: "0xabc", issuedAt: Date.now() };
const identity = { questId: "quest-daily", scopeKey: "2026-09-12", claimNonce: 20708n, deadline: 1789257599n };

beforeEach(() => {
  vi.clearAllMocks();
  mockIsBlacklisted.mockResolvedValue(false);
  mockGetCeloTxCount.mockResolvedValue(100);
});

describe("dailyCheckinAdapter.resolveIdentity", () => {
  it("uses the legacy epoch-day claim nonce, not a generic hashed one", async () => {
    const result = await dailyCheckinAdapter.resolveIdentity(session);
    expect(result.questId).toBe("quest-daily");
    // Legacy nonce is small (floor(unixSeconds/86400)) — nowhere near the
    // generic namespace's high bit.
    expect(result.claimNonce).toBeLessThan(1n << 40n);
  });
});

describe("dailyCheckinAdapter.verifyEligibility", () => {
  it("blocks a blacklisted wallet", async () => {
    mockIsBlacklisted.mockResolvedValue(true);
    const result = await dailyCheckinAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "blacklisted" }));
  });

  it("enforces the minimum activity gate for a browser session", async () => {
    mockGetCeloTxCount.mockResolvedValue(0);
    const result = await dailyCheckinAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(expect.objectContaining({ ok: false, code: "insufficient-activity" }));
  });

  it("exempts a MiniPay session from the activity gate", async () => {
    mockGetCeloTxCount.mockResolvedValue(0);
    const result = await dailyCheckinAdapter.verifyEligibility({ ...session, authProvider: "minipay" }, identity);
    expect(mockGetCeloTxCount).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("fails closed on an RPC error checking activity", async () => {
    mockGetCeloTxCount.mockRejectedValue(new Error("RPC down"));
    const result = await dailyCheckinAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(expect.objectContaining({ ok: false, status: 503, code: "chain-unavailable" }));
  });

  it("returns the daily_engagement finalizer with the resolved scope as claimDate", async () => {
    const result = await dailyCheckinAdapter.verifyEligibility(session, identity);
    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        result: expect.objectContaining({
          basePoints: 10,
          finalizerKind: "daily_engagement",
          finalizerPayload: { questId: "quest-daily", claimDate: "2026-09-12" },
        }),
      }),
    );
  });
});

describe("dailyCheckinAdapter.legacyIdempotencyKey", () => {
  it("matches claimQueuedDailyReward's own key format", () => {
    const key = dailyCheckinAdapter.legacyIdempotencyKey!(identity, "0xABC");
    expect(key).toBe("daily:quest-daily:0xabc:2026-09-12");
  });
});
