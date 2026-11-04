/**
 * The marketing site renders www/shops from these two endpoints, so the shape
 * here is a contract with another deployment. Two properties matter most and
 * neither is visible from the marketing site's own tests:
 *
 * 1. No signed, expiring URL may reach the payload. Customer visit photos
 *    carry 15-minute signed URLs; baking one into CDN-cached HTML means
 *    broken images. The contract drops them, and this locks that.
 * 2. Only indexable profiles are exposed by default, matching the sitemap and
 *    the Pass profile pages, so the index-facing surface can't fill up with
 *    stubs.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

class MockDirectoryUnavailableError extends Error {}

const getPublicMerchantMock = vi.fn();
const listPublicMerchantsMock = vi.fn();
vi.mock("@/lib/merchants/queries", () => ({
  DirectoryUnavailableError: MockDirectoryUnavailableError,
  getPublicMerchant: (...args: unknown[]) => getPublicMerchantMock(...args),
  listPublicMerchants: (...args: unknown[]) => listPublicMerchantsMock(...args),
}));

const { GET: getProfile } = await import("@/app/api/public/directory/merchants/[slug]/route");
const { GET: getList } = await import("@/app/api/public/directory/merchants/route");

const COMPLETE_DESCRIPTION =
  "A specialty coffee roastery on Ngong Road serving single-origin Kenyan beans and all-day breakfast.";

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    slug: "arabica-coffee-house",
    name: "Arabica Coffee House",
    shortDescription: COMPLETE_DESCRIPTION,
    logoUrl: "https://cdn.example.com/logo.png",
    primaryCategory: { slug: "coffee", name: "Coffee shop" },
    categories: [{ slug: "coffee", name: "Coffee shop" }],
    operatingModel: "physical",
    primaryLocation: { id: "l1", locality: "Kilimani", city: "Nairobi", latitude: -1.3, longitude: 36.78 },
    branchCount: 1,
    voucherCount: 1,
    distanceKm: null,
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ...summary(),
    description: COMPLETE_DESCRIPTION,
    bannerUrl: "https://cdn.example.com/banner.png",
    websiteUrl: "https://arabica.co.ke",
    contacts: {
      phone: "+254700000000", email: null, whatsapp: null,
      instagram: "https://instagram.com/arabica", facebook: null,
    },
    locations: [
      {
        id: "l1", name: "Kilimani", locationType: "store",
        addressLine1: "Ngong Road", addressLine2: null, building: "Adlife Plaza",
        floorOrUnit: null, landmark: "Opposite the mall", locality: "Kilimani",
        city: "Nairobi", countyOrRegion: "Nairobi County", postalCode: "00100",
        countryCode: "KE", latitude: -1.3, longitude: 36.78, mapsUrl: null,
        publicPhone: null, publicEmail: null, publicWhatsapp: null,
        timezone: "Africa/Nairobi",
        openingHours: { version: 1, monday: [{ opens: "07:00", closes: "19:00" }] },
        isPrimary: true, acceptsAkibaPass: true, acceptsVouchers: true,
      },
    ],
    coreOfferings: [{ id: "c1", name: "Pour-over coffee", description: "Single origin" }],
    merchantMedia: [
      {
        id: "media-1", kind: "business",
        imageUrl: "https://cdn.example.com/shop.png",
        thumbnailUrl: "https://cdn.example.com/shop-thumb.png",
        altText: "Shopfront", title: null,
      },
    ],
    offers: [],
    verifiedVisits: [
      {
        id: "v1", favoriteOrder: "Flat white", experienceLabels: ["Quick service"],
        photos: [
          {
            id: "p1", visitId: "v1",
            thumbnailUrl: "https://storage.example.com/signed-thumb?token=SIGNED_TOKEN",
            displayUrl: "https://storage.example.com/signed-display?token=SIGNED_TOKEN",
            altText: "Photo from a verified visit", itemLabel: null,
          },
        ],
      },
    ],
    verifiedVisitFavoriteProduct: "Flat white",
    approvedCustomerPhotos: [
      {
        id: "p1", visitId: "v1",
        thumbnailUrl: "https://storage.example.com/signed-thumb?token=SIGNED_TOKEN",
        displayUrl: "https://storage.example.com/signed-display?token=SIGNED_TOKEN",
        altText: "Photo from a verified visit", itemLabel: null,
      },
    ],
    vouchers: [
      {
        id: "vch1", title: "Free pastry", voucherType: "free", milesCost: 250,
        discountPercent: null, discountCusd: null, applicableCategory: null,
        linkedProductId: null, retailValueCusd: 2, cooldownSeconds: 0,
        globalCap: null, expiresAt: null, branchIds: null,
      },
    ],
    ...overrides,
  };
}

function profileRequest(slug: string, query = "") {
  return {
    request: new Request(`http://localhost/api/public/directory/merchants/${slug}${query}`),
    params: { slug },
  };
}

describe("GET /api/public/directory/merchants/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves with no actor identity, so every caller gets the same bytes", async () => {
    getPublicMerchantMock.mockResolvedValue(detail());
    const { request, params } = profileRequest("arabica-coffee-house");
    await getProfile(request, { params });
    expect(getPublicMerchantMock).toHaveBeenCalledWith("arabica-coffee-house", null);
  });

  it("never leaks a signed customer-photo URL", async () => {
    getPublicMerchantMock.mockResolvedValue(detail());
    const { request, params } = profileRequest("arabica-coffee-house");
    const body = await (await getProfile(request, { params })).text();
    expect(body).not.toContain("SIGNED_TOKEN");
    expect(body).not.toContain("storage.example.com");
  });

  it("keeps the textual half of a verified visit", async () => {
    getPublicMerchantMock.mockResolvedValue(detail());
    const { request, params } = profileRequest("arabica-coffee-house");
    const { merchant } = await (await getProfile(request, { params })).json();
    expect(merchant.verifiedVisits).toEqual([
      { favoriteOrder: "Flat white", experienceLabels: ["Quick service"] },
    ]);
    expect(merchant.verifiedVisitFavoriteProduct).toBe("Flat white");
  });

  it("omits internal merchant ids", async () => {
    getPublicMerchantMock.mockResolvedValue(detail());
    const { request, params } = profileRequest("arabica-coffee-house");
    const { merchant } = await (await getProfile(request, { params })).json();
    expect(merchant).not.toHaveProperty("id");
  });

  it("builds a street address without the city, and a directions URL", async () => {
    getPublicMerchantMock.mockResolvedValue(detail());
    const { request, params } = profileRequest("arabica-coffee-house");
    const { merchant } = await (await getProfile(request, { params })).json();
    expect(merchant.locations[0].streetAddress).toBe("Ngong Road, Adlife Plaza, Kilimani");
    expect(merchant.locations[0].city).toBe("Nairobi");
    expect(merchant.locations[0].directionsUrl).toContain("google.com/maps");
  });

  it("is cacheable, because nothing in the payload expires", async () => {
    getPublicMerchantMock.mockResolvedValue(detail());
    const { request, params } = profileRequest("arabica-coffee-house");
    const response = await getProfile(request, { params });
    expect(response.headers.get("Cache-Control")).toContain("s-maxage");
    expect(response.headers.get("Cache-Control")).not.toContain("no-store");
  });

  it("404s a stub profile rather than handing over a thin page", async () => {
    getPublicMerchantMock.mockResolvedValue(detail({ shortDescription: "Too short", logoUrl: null }));
    const { request, params } = profileRequest("arabica-coffee-house");
    const response = await getProfile(request, { params });
    expect(response.status).toBe(404);
  });

  it("can be asked for a stub profile explicitly with indexableOnly=false", async () => {
    getPublicMerchantMock.mockResolvedValue(detail({ shortDescription: "Too short", logoUrl: null }));
    const { request, params } = profileRequest("arabica-coffee-house", "?indexableOnly=false");
    const response = await getProfile(request, { params });
    expect(response.status).toBe(200);
  });

  it("404s an unknown slug", async () => {
    getPublicMerchantMock.mockResolvedValue(null);
    const { request, params } = profileRequest("nope");
    expect((await getProfile(request, { params })).status).toBe(404);
  });

  it("reports a directory outage as a retryable 503 that is never cached", async () => {
    getPublicMerchantMock.mockRejectedValue(new MockDirectoryUnavailableError("db down"));
    const { request, params } = profileRequest("arabica-coffee-house");
    const response = await getProfile(request, { params });
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/public/directory/merchants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only indexable merchants by default", async () => {
    listPublicMerchantsMock.mockResolvedValue({
      merchants: [summary(), summary({ slug: "stub", shortDescription: "Short", logoUrl: null })],
      next_cursor: null,
    });
    const response = await getList(new Request("http://localhost/api/public/directory/merchants"));
    const body = await response.json();
    expect(body.merchants.map((m: { slug: string }) => m.slug)).toEqual(["arabica-coffee-house"]);
  });

  it("passes filters through and clamps an oversized limit", async () => {
    listPublicMerchantsMock.mockResolvedValue({ merchants: [], next_cursor: null });
    await getList(
      new Request("http://localhost/api/public/directory/merchants?category=coffee&city=Nairobi&limit=500")
    );
    expect(listPublicMerchantsMock).toHaveBeenCalledWith(
      expect.objectContaining({ category: "coffee", city: "Nairobi", limit: 50 })
    );
  });

  it("falls back to the default limit for a non-numeric value", async () => {
    listPublicMerchantsMock.mockResolvedValue({ merchants: [], next_cursor: null });
    await getList(new Request("http://localhost/api/public/directory/merchants?limit=abc"));
    expect(listPublicMerchantsMock).toHaveBeenCalledWith(expect.objectContaining({ limit: 24 }));
  });

  it("surfaces the pagination cursor under its wire name", async () => {
    listPublicMerchantsMock.mockResolvedValue({ merchants: [summary()], next_cursor: "cursor-2" });
    const body = await (
      await getList(new Request("http://localhost/api/public/directory/merchants"))
    ).json();
    expect(body.nextCursor).toBe("cursor-2");
  });

  it("reports a directory outage as a 503 that is never cached", async () => {
    listPublicMerchantsMock.mockRejectedValue(new MockDirectoryUnavailableError("db down"));
    const response = await getList(new Request("http://localhost/api/public/directory/merchants"));
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
