import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({ actor: null as Actor }));

vi.mock("@/lib/auth/requestActor", () => {
  class MockUnauthorizedError extends Error {
    readonly status = 401;
    readonly code = "UNAUTHORIZED";
  }
  return {
    UnauthorizedError: MockUnauthorizedError,
    requireActor: async () => {
      if (!state.actor) throw new MockUnauthorizedError("Unauthorized");
      return state.actor;
    },
  };
});

const getSignedInBalanceMock = vi.fn();
vi.mock("@/lib/merchants/enrich", () => ({
  getSignedInBalance: (...args: unknown[]) => getSignedInBalanceMock(...args),
}));

const getClaimedAllocationIdsMock = vi.fn();
const getLoyaltyOffersMock = vi.fn();
vi.mock("@/lib/vouchers/catalogue.server", () => ({
  getClaimedAllocationIds: (...args: unknown[]) => getClaimedAllocationIdsMock(...args),
  getLoyaltyOffers: (...args: unknown[]) => getLoyaltyOffersMock(...args),
}));

const getVoucherClaimFrictionMock = vi.fn();
vi.mock("@/lib/vouchers/claimIntent", () => ({
  getVoucherClaimFriction: (...args: unknown[]) => getVoucherClaimFrictionMock(...args),
}));

const { GET } = await import("@/app/api/v1/me/voucher-state/route");

function req() {
  return new Request("http://localhost/api/v1/me/voucher-state");
}

describe("GET /api/v1/me/voucher-state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    getSignedInBalanceMock.mockResolvedValue(80);
    getClaimedAllocationIdsMock.mockResolvedValue(new Set(["a1"]));
    getLoyaltyOffersMock.mockResolvedValue([{ templateId: "l1", eligible: true }]);
    getVoucherClaimFrictionMock.mockResolvedValue({
      expiredUnusedCount: 0,
      activeUnusedCount: 0,
      redeemedCount: 0,
      requiresUsePlan: false,
    });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it("scopes every loader to the requesting actor and returns all four fields", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({
      balance: 80,
      claimedFundedAllocationIds: ["a1"],
      loyaltyOffers: [{ templateId: "l1", eligible: true }],
      claimFriction: { expiredUnusedCount: 0, activeUnusedCount: 0, redeemedCount: 0, requiresUsePlan: false },
    });
    expect(getSignedInBalanceMock).toHaveBeenCalledWith("u1", "a@example.com");
    expect(getClaimedAllocationIdsMock).toHaveBeenCalledWith("u1", "a@example.com");
    expect(getLoyaltyOffersMock).toHaveBeenCalledWith("u1", "a@example.com");
    expect(getVoucherClaimFrictionMock).toHaveBeenCalledWith("u1");
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
