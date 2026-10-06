import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  merchant: null as Record<string, unknown> | null,
  shouldThrowUnavailable: false,
  fundedOffers: [] as Array<{ allocationId: string }>,
}));

class MockDirectoryUnavailableError extends Error {}

const getPublicMerchantMock = vi.fn();
vi.mock("@/lib/merchants/queries", () => ({
  DirectoryUnavailableError: MockDirectoryUnavailableError,
  getPublicMerchant: (...args: unknown[]) => getPublicMerchantMock(...args),
}));

const getMerchantFundedOffersMock = vi.fn();
vi.mock("@/lib/vouchers/merchantFundedOffers.server", () => ({
  getMerchantFundedOffers: (...args: unknown[]) => getMerchantFundedOffersMock(...args),
}));

const { GET } = await import("@/app/api/v1/merchants/[slug]/route");

function req(slug: string) {
  return { req: new Request(`http://localhost/api/v1/merchants/${slug}`), params: { slug } };
}

describe("GET /api/v1/merchants/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.merchant = null;
    state.shouldThrowUnavailable = false;
    state.fundedOffers = [];

    getPublicMerchantMock.mockImplementation(async () => {
      if (state.shouldThrowUnavailable) throw new MockDirectoryUnavailableError("db down");
      return state.merchant;
    });
    getMerchantFundedOffersMock.mockImplementation(async () => state.fundedOffers);
  });

  it("resolves with no actor identity — always calls getPublicMerchant(slug, null)", async () => {
    state.merchant = { id: "m1", slug: "acme", vouchers: [] };
    const { req: r, params } = req("acme");
    await GET(r, { params });
    expect(getPublicMerchantMock).toHaveBeenCalledWith("acme", null);
  });

  it("returns 404 for a merchant that doesn't resolve", async () => {
    const { req: r, params } = req("nope");
    const res = await GET(r, { params });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("MERCHANT_NOT_FOUND");
  });

  it("returns 503 when the directory is unavailable, without leaking the raw error", async () => {
    state.shouldThrowUnavailable = true;
    const { req: r, params } = req("acme");
    const res = await GET(r, { params });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("DIRECTORY_UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("db down");
  });

  it("never includes balance/saved/claimed fields — those live in the self-only overlay", async () => {
    state.merchant = { id: "m1", slug: "acme", vouchers: [] };
    const { req: r, params } = req("acme");
    const res = await GET(r, { params });
    const body = await res.json();
    expect(body.data).not.toHaveProperty("balance");
    expect(body.data).not.toHaveProperty("saved");
    expect(body.data).not.toHaveProperty("claimedFundedAllocationIds");
    expect(body.data.merchant).not.toHaveProperty("vouchers");
    expect(body.data.vouchers).toEqual([]);
  });

  it("is publicly cacheable", async () => {
    state.merchant = { id: "m1", slug: "acme", vouchers: [] };
    const { req: r, params } = req("acme");
    const res = await GET(r, { params });
    expect(res.headers.get("cache-control")).toContain("public");
  });
});
