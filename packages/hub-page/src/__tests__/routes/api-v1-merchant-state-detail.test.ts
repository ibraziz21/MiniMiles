import { beforeEach, describe, expect, it, vi } from "vitest";

type Actor = { userId: string; email: string | null; authMode: "cookie" | "bearer" } | null;

const state = vi.hoisted(() => ({
  actor: null as Actor,
  merchant: null as { id: string } | null,
  shouldThrowUnavailable: false,
  fundedOffers: [{ allocationId: "alloc-1" }, { allocationId: "alloc-2" }] as Array<{ allocationId: string }>,
  claimedByUser: new Map<string, Set<string>>(),
  savedByUser: new Map<string, boolean>(),
}));

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

class MockDirectoryUnavailableError extends Error {}
const getPublicMerchantMock = vi.fn();
vi.mock("@/lib/merchants/queries", () => ({
  DirectoryUnavailableError: MockDirectoryUnavailableError,
  getPublicMerchant: (...args: unknown[]) => getPublicMerchantMock(...args),
}));

const getSignedInBalanceMock = vi.fn();
vi.mock("@/lib/merchants/enrich", () => ({
  getSignedInBalance: (...args: unknown[]) => getSignedInBalanceMock(...args),
}));

const isMerchantSavedMock = vi.fn();
vi.mock("@/lib/merchants/savedMerchants", () => ({
  isMerchantSaved: (...args: unknown[]) => isMerchantSavedMock(...args),
}));

const getMemberVerifiedVisitSummaryMock = vi.fn();
const hasOpenMerchantContributionRequestMock = vi.fn();
vi.mock("@/lib/merchants/memberVisits", () => ({
  getMemberVerifiedVisitSummary: (...args: unknown[]) => getMemberVerifiedVisitSummaryMock(...args),
  hasOpenMerchantContributionRequest: (...args: unknown[]) => hasOpenMerchantContributionRequestMock(...args),
}));

const getMerchantFundedOffersMock = vi.fn();
const getClaimedMerchantFundedAllocationIdsMock = vi.fn();
vi.mock("@/lib/vouchers/merchantFundedOffers.server", () => ({
  getMerchantFundedOffers: (...args: unknown[]) => getMerchantFundedOffersMock(...args),
  getClaimedMerchantFundedAllocationIds: (...args: unknown[]) => getClaimedMerchantFundedAllocationIdsMock(...args),
}));

const { GET } = await import("@/app/api/v1/me/merchant-state/[slug]/route");

function req(slug: string) {
  return { req: new Request(`http://localhost/api/v1/me/merchant-state/${slug}`), params: { slug } };
}

describe("GET /api/v1/me/merchant-state/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.actor = null;
    state.merchant = { id: "m1" };
    state.shouldThrowUnavailable = false;
    state.fundedOffers = [{ allocationId: "alloc-1" }, { allocationId: "alloc-2" }];
    state.claimedByUser = new Map();
    state.savedByUser = new Map();

    getPublicMerchantMock.mockImplementation(async () => {
      if (state.shouldThrowUnavailable) throw new MockDirectoryUnavailableError("db down");
      return state.merchant;
    });
    getMerchantFundedOffersMock.mockImplementation(async () => state.fundedOffers);
    getSignedInBalanceMock.mockResolvedValue(50);
    getClaimedMerchantFundedAllocationIdsMock.mockImplementation(
      async (_allocationIds: string[], userId: string) => state.claimedByUser.get(userId) ?? new Set(),
    );
    isMerchantSavedMock.mockImplementation(async (userId: string) => state.savedByUser.get(userId) ?? false);
    getMemberVerifiedVisitSummaryMock.mockResolvedValue(null);
    hasOpenMerchantContributionRequestMock.mockResolvedValue(false);
  });

  it("returns 401 when unauthenticated", async () => {
    const { req: r, params } = req("acme");
    const res = await GET(r, { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the merchant doesn't resolve", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.merchant = null;
    const { req: r, params } = req("nope");
    const res = await GET(r, { params });
    expect(res.status).toBe(404);
  });

  it("returns 503 on directory unavailability without leaking the raw error", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    state.shouldThrowUnavailable = true;
    const { req: r, params } = req("acme");
    const res = await GET(r, { params });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain("db down");
  });

  it("never mixes one user's claimed/saved state into another user's response", async () => {
    state.claimedByUser.set("user-a", new Set(["alloc-1"]));
    state.savedByUser.set("user-a", true);
    state.claimedByUser.set("user-b", new Set());
    state.savedByUser.set("user-b", false);

    state.actor = { userId: "user-a", email: "a@example.com", authMode: "bearer" };
    const userA = await (await GET(req("acme").req, { params: { slug: "acme" } })).json();

    state.actor = { userId: "user-b", email: "b@example.com", authMode: "bearer" };
    const userB = await (await GET(req("acme").req, { params: { slug: "acme" } })).json();

    expect(userA.data.saved).toBe(true);
    expect(userA.data.claimedFundedAllocationIds).toEqual(["alloc-1"]);
    expect(userB.data.saved).toBe(false);
    expect(userB.data.claimedFundedAllocationIds).toEqual([]);

    // Every call that can see claim/saved state was scoped to the actor making the request.
    expect(getClaimedMerchantFundedAllocationIdsMock).toHaveBeenCalledWith(
      expect.any(Array),
      "user-a",
      "a@example.com",
    );
    expect(getClaimedMerchantFundedAllocationIdsMock).toHaveBeenCalledWith(
      expect.any(Array),
      "user-b",
      "b@example.com",
    );
    expect(isMerchantSavedMock).toHaveBeenCalledWith("user-a", "m1");
    expect(isMerchantSavedMock).toHaveBeenCalledWith("user-b", "m1");
  });

  it("is private, no-store", async () => {
    state.actor = { userId: "u1", email: "a@example.com", authMode: "bearer" };
    const { req: r, params } = req("acme");
    const res = await GET(r, { params });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
