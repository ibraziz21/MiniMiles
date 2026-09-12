import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSession = vi.fn();
const mockClaimQueuedDailyReward = vi.fn();
const mockIsSelfClaimEnabledForWallet = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireSession: () => mockRequireSession(),
  isMiniPaySession: () => false,
  logSessionAge: () => true,
}));

vi.mock("@/lib/minipointQueue", () => ({
  claimQueuedDailyReward: (...args: any[]) => mockClaimQueuedDailyReward(...args),
}));

vi.mock("@/lib/blacklist", () => ({ isBlacklisted: async () => false }));

vi.mock("@/lib/questRegistry", () => ({
  getQuest: () => ({ questId: "quest-daily", points: 10, reason: "daily-engagement:quest-daily" }),
}));

vi.mock("@/lib/celoClient", () => ({ getCeloTxCount: async () => 100 }));

vi.mock("@/lib/server/dailySelfClaimMode", () => ({
  isSelfClaimEnabledForWallet: (...args: any[]) => mockIsSelfClaimEnabledForWallet(...args),
}));

const { POST } = await import("@/app/api/quests/daily/route");

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSession.mockResolvedValue({ walletAddress: "0xabc", issuedAt: Date.now() - 120_000 });
});

afterEach(() => {
  delete process.env.MIN_CELO_TX_COUNT;
});

describe("POST /api/quests/daily — self-claim cutover gate", () => {
  it("does not enqueue a mint job once this wallet is in self-claim mode", async () => {
    mockIsSelfClaimEnabledForWallet.mockReturnValue(true);

    const res = await POST(new Request("http://localhost/api/quests/daily", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual(
      expect.objectContaining({ success: false, code: "self-claim-required" }),
    );
    expect(mockClaimQueuedDailyReward).not.toHaveBeenCalled();
  });

  it("keeps enqueueing normally for wallets not yet on self-claim", async () => {
    mockIsSelfClaimEnabledForWallet.mockReturnValue(false);
    mockClaimQueuedDailyReward.mockResolvedValue({
      ok: true,
      queued: true,
      txHash: undefined,
      points: 10,
      basePoints: 10,
      vaultBoost: { applied: false, multiplier: 1, minBalanceUsdt: 0 },
    });

    const res = await POST(new Request("http://localhost/api/quests/daily", { method: "POST" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockClaimQueuedDailyReward).toHaveBeenCalledTimes(1);
  });
});
