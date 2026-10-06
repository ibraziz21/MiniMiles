import { beforeEach, describe, expect, it, vi } from "vitest";

const getAllTemplatesMock = vi.fn();
const getFundedOffersMock = vi.fn();
const getLoyaltyOffersMock = vi.fn();
const getClaimedAllocationIdsMock = vi.fn();
vi.mock("@/lib/vouchers/catalogue.server", () => ({
  getAllTemplates: (...args: unknown[]) => getAllTemplatesMock(...args),
  getFundedOffers: (...args: unknown[]) => getFundedOffersMock(...args),
  getLoyaltyOffers: (...args: unknown[]) => getLoyaltyOffersMock(...args),
  getClaimedAllocationIds: (...args: unknown[]) => getClaimedAllocationIdsMock(...args),
}));

const getSignedInBalanceMock = vi.fn();
vi.mock("@/lib/merchants/enrich", () => ({
  getSignedInBalance: (...args: unknown[]) => getSignedInBalanceMock(...args),
}));

const { GET } = await import("@/app/api/v1/vouchers/route");

function req() {
  return new Request("http://localhost/api/v1/vouchers");
}

describe("GET /api/v1/vouchers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllTemplatesMock.mockResolvedValue([{ id: "t1" }]);
    getFundedOffersMock.mockResolvedValue([{ allocationId: "a1" }]);
  });

  it("resolves templates/fundedOffers with no actor identity", async () => {
    await GET(req());
    expect(getAllTemplatesMock).toHaveBeenCalledWith(null);
    expect(getFundedOffersMock).toHaveBeenCalledWith();
  });

  it("never calls any self-only loader — this route is identity-independent", async () => {
    await GET(req());
    expect(getSignedInBalanceMock).not.toHaveBeenCalled();
    expect(getClaimedAllocationIdsMock).not.toHaveBeenCalled();
    expect(getLoyaltyOffersMock).not.toHaveBeenCalled();
  });

  it("returns templates and fundedOffers from the public catalogue", async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual({ templates: [{ id: "t1" }], fundedOffers: [{ allocationId: "a1" }] });
  });

  it("is publicly cacheable", async () => {
    const res = await GET(req());
    expect(res.headers.get("cache-control")).toContain("public");
  });
});
