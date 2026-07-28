import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireSession = vi.fn();
const mockGetStatuses = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireSession: () => mockRequireSession(),
}));

vi.mock("@/lib/server/merchantQuestVerification", () => ({
  getMerchantQuestStatuses: (...args: unknown[]) => mockGetStatuses(...args),
}));

describe("GET /api/merchant-quests/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireSession.mockResolvedValue({
      walletAddress: "0xabcdef",
      issuedAt: Date.now(),
    });
  });

  afterEach(() => {
    delete process.env.MERCHANT_QUESTS_ENABLED;
    delete process.env.MERCHANT_QUESTS_ROLLOUT_PERCENT;
    delete process.env.MERCHANT_QUESTS_ALLOWLIST;
  });

  it("fails closed without querying quest state", async () => {
    const { GET } = await import("@/app/api/merchant-quests/status/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false, quests: [] });
    expect(mockGetStatuses).not.toHaveBeenCalled();
  });

  it("returns state for a wallet in the enabled cohort", async () => {
    process.env.MERCHANT_QUESTS_ENABLED = "true";
    process.env.MERCHANT_QUESTS_ROLLOUT_PERCENT = "100";
    mockGetStatuses.mockResolvedValue([{ questId: "quest-1", state: "eligible" }]);

    const { GET } = await import("@/app/api/merchant-quests/status/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: true,
      quests: [{ questId: "quest-1", state: "eligible" }],
    });
    expect(mockGetStatuses).toHaveBeenCalledWith("0xabcdef");
  });
});
