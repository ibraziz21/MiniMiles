import { beforeEach, describe, expect, it, vi } from "vitest";

const listPublicMerchantOffersMock = vi.fn();

vi.mock("@/lib/merchants/publicOffers", () => ({
  listPublicMerchantOffers: (...args: unknown[]) => listPublicMerchantOffersMock(...args),
}));

const { GET } = await import("@/app/api/v1/merchant-offers/route");

describe("GET /api/v1/merchant-offers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listPublicMerchantOffersMock.mockResolvedValue([]);
  });

  it("returns the complete public business-offer feed", async () => {
    const offer = { id: "offer-1", title: "Saturday special" };
    listPublicMerchantOffersMock.mockResolvedValue([offer]);

    const response = await GET(new Request("http://localhost/api/v1/merchant-offers"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({ offers: [offer] });
    expect(listPublicMerchantOffersMock).toHaveBeenCalledWith(50);
  });

  it("allows short public caching without storing member state", async () => {
    const response = await GET(new Request("http://localhost/api/v1/merchant-offers"));

    expect(response.headers.get("cache-control")).toBe("public, max-age=30, stale-while-revalidate=120");
  });
});
