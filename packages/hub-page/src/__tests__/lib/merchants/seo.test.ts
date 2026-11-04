/**
 * The indexing gate and the structured data are the two places where a
 * mistake is invisible locally and expensive in search: a stub profile that
 * leaks into the index, or a rating we never actually collected.
 */
import { describe, it, expect } from "vitest";
import {
  buildMerchantJsonLd,
  isProfileIndexable,
  MIN_SHORT_DESCRIPTION_CHARS,
} from "@/lib/merchants/seo";
import type {
  PublicMerchantDetail,
  PublicMerchantLocation,
  PublicMerchantSummary,
} from "@/lib/merchants/types";

const PROFILE_URL = "https://www.akibamiles.com/shops/arabica-coffee-house";

const LONG_DESCRIPTION = "A specialty coffee roastery on Ngong Road serving single-origin Kenyan beans, pastries and all-day breakfast.";

function summary(overrides: Partial<PublicMerchantSummary> = {}): PublicMerchantSummary {
  return {
    id: "m1",
    slug: "arabica-coffee-house",
    name: "Arabica Coffee House",
    shortDescription: LONG_DESCRIPTION,
    logoUrl: "https://cdn.example.com/logo.png",
    primaryCategory: { slug: "coffee", name: "Coffee shop" },
    categories: [{ slug: "coffee", name: "Coffee shop" }],
    operatingModel: "physical",
    primaryLocation: { id: "l1", locality: "Kilimani", city: "Nairobi", latitude: -1.3, longitude: 36.78 },
    branchCount: 1,
    voucherCount: 2,
    distanceKm: null,
    ...overrides,
  };
}

function location(overrides: Partial<PublicMerchantLocation> = {}): PublicMerchantLocation {
  return {
    id: "l1",
    name: "Kilimani",
    locationType: "store",
    addressLine1: "Ngong Road",
    addressLine2: null,
    building: "Adlife Plaza",
    floorOrUnit: null,
    landmark: null,
    locality: "Kilimani",
    city: "Nairobi",
    countyOrRegion: "Nairobi County",
    postalCode: "00100",
    countryCode: "KE",
    latitude: -1.3,
    longitude: 36.78,
    mapsUrl: null,
    publicPhone: null,
    publicEmail: null,
    publicWhatsapp: null,
    timezone: "Africa/Nairobi",
    openingHours: {
      version: 1,
      monday: [{ opens: "07:00", closes: "19:00" }],
      saturday: [{ opens: "08:00", closes: "22:00" }],
    },
    isPrimary: true,
    acceptsAkibaPass: true,
    acceptsVouchers: true,
    ...overrides,
  };
}

function detail(overrides: Partial<PublicMerchantDetail> = {}): PublicMerchantDetail {
  return {
    ...summary(),
    description: LONG_DESCRIPTION,
    bannerUrl: "https://cdn.example.com/banner.png",
    websiteUrl: "https://arabica.co.ke",
    contacts: {
      phone: "+254700000000",
      email: "hello@arabica.co.ke",
      whatsapp: null,
      instagram: "https://instagram.com/arabica",
      facebook: null,
    },
    locations: [location()],
    coreOfferings: [],
    merchantMedia: [],
    offers: [],
    verifiedVisits: [],
    verifiedVisitFavoriteProduct: null,
    approvedCustomerPhotos: [],
    vouchers: [],
    ...overrides,
  };
}

describe("isProfileIndexable", () => {
  it("accepts a merchant with a real description, a logo and a location", () => {
    expect(isProfileIndexable(summary())).toBe(true);
  });

  it("rejects a stub description below the minimum", () => {
    const short = "x".repeat(MIN_SHORT_DESCRIPTION_CHARS - 1);
    expect(isProfileIndexable(summary({ shortDescription: short }))).toBe(false);
  });

  it("rejects a missing description", () => {
    expect(isProfileIndexable(summary({ shortDescription: null }))).toBe(false);
  });

  it("does not count whitespace padding towards the minimum", () => {
    const padded = `${" ".repeat(200)}Nice shop.${" ".repeat(200)}`;
    expect(isProfileIndexable(summary({ shortDescription: padded }))).toBe(false);
  });

  it("rejects a merchant with no logo", () => {
    expect(isProfileIndexable(summary({ logoUrl: null }))).toBe(false);
  });

  it("rejects a physical merchant with no location", () => {
    expect(isProfileIndexable(summary({ primaryLocation: null }))).toBe(false);
  });

  it("accepts an online-only merchant with no location", () => {
    expect(
      isProfileIndexable(summary({ operatingModel: "online", primaryLocation: null }))
    ).toBe(true);
  });

  it("applies the same rule to a full detail object as to a summary", () => {
    // The sitemap sees summaries and the page sees details; they must agree.
    expect(isProfileIndexable(detail())).toBe(true);
    expect(isProfileIndexable(detail({ logoUrl: null }))).toBe(false);
  });
});

describe("buildMerchantJsonLd", () => {
  it("emits a LocalBusiness with address, geo and canonical @id", () => {
    const jsonLd = buildMerchantJsonLd(detail(), PROFILE_URL)!;
    expect(jsonLd["@type"]).toBe("LocalBusiness");
    expect(jsonLd["@id"]).toBe(PROFILE_URL);
    expect(jsonLd.address).toMatchObject({
      "@type": "PostalAddress",
      addressLocality: "Nairobi",
      addressRegion: "Nairobi County",
      postalCode: "00100",
      addressCountry: "KE",
    });
    expect(jsonLd.geo).toMatchObject({ latitude: -1.3, longitude: 36.78 });
  });

  it("keeps the city out of streetAddress so it isn't duplicated", () => {
    const jsonLd = buildMerchantJsonLd(detail(), PROFILE_URL)!;
    const address = jsonLd.address as Record<string, string>;
    expect(address.streetAddress).toBe("Ngong Road, Adlife Plaza, Kilimani");
    expect(address.streetAddress).not.toContain("Nairobi");
  });

  it("maps opening hours to OpeningHoursSpecification entries", () => {
    const jsonLd = buildMerchantJsonLd(detail(), PROFILE_URL)!;
    expect(jsonLd.openingHoursSpecification).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Monday",
        opens: "07:00",
        closes: "19:00",
      },
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Saturday",
        opens: "08:00",
        closes: "22:00",
      },
    ]);
  });

  it("collects website and socials into sameAs, skipping blanks", () => {
    const jsonLd = buildMerchantJsonLd(detail(), PROFILE_URL)!;
    expect(jsonLd.sameAs).toEqual([
      "https://arabica.co.ke",
      "https://instagram.com/arabica",
    ]);
  });

  it("never emits a rating — verified visits carry no rating value", () => {
    const jsonLd = buildMerchantJsonLd(
      detail({
        verifiedVisits: [
          { id: "v1", favoriteOrder: "Flat white", experienceLabels: ["Quick service"], photos: [] },
        ],
      }),
      PROFILE_URL
    )!;
    expect(jsonLd).not.toHaveProperty("aggregateRating");
    expect(jsonLd).not.toHaveProperty("review");
    expect(jsonLd).not.toHaveProperty("ratingValue");
  });

  it("includes merchant-run offers but not Miles-priced vouchers", () => {
    const jsonLd = buildMerchantJsonLd(
      detail({
        offers: [
          {
            id: "o1",
            title: "Two-for-one Tuesdays",
            description: "Buy one coffee, get one free, all day Tuesday.",
            terms: null,
            schedule: "weekly",
            daysOfWeek: [2],
            startTime: null,
            endTime: null,
            startsOn: "2026-01-01",
            endsOn: "2026-06-30",
            timezone: "Africa/Nairobi",
            remindersEnabled: true,
            reminderSet: false,
            imageUrl: null,
            requiresAkibaMiles: false,
          },
        ],
        vouchers: [
          {
            id: "vch1",
            title: "Free pastry",
            voucherType: "free",
            milesCost: 250,
            discountPercent: null,
            discountCusd: null,
            applicableCategory: null,
            linkedProductId: null,
            retailValueCusd: 2,
            cooldownSeconds: 0,
            globalCap: null,
            expiresAt: null,
            branchIds: null,
          },
        ],
      }),
      PROFILE_URL
    )!;

    expect(jsonLd.makesOffer).toEqual([
      {
        "@type": "Offer",
        name: "Two-for-one Tuesdays",
        description: "Buy one coffee, get one free, all day Tuesday.",
        availabilityStarts: "2026-01-01",
        availabilityEnds: "2026-06-30",
      },
    ]);
    expect(JSON.stringify(jsonLd)).not.toContain("Free pastry");
  });

  it("describes an online-only merchant as an Organization with no address", () => {
    const jsonLd = buildMerchantJsonLd(
      detail({ operatingModel: "online", locations: [], primaryLocation: null }),
      PROFILE_URL
    )!;
    expect(jsonLd["@type"]).toBe("Organization");
    expect(jsonLd).not.toHaveProperty("address");
    expect(jsonLd).not.toHaveProperty("openingHoursSpecification");
  });

  it("returns null for a physical merchant with no location rather than an addressless LocalBusiness", () => {
    expect(buildMerchantJsonLd(detail({ locations: [] }), PROFILE_URL)).toBeNull();
  });

  it("falls back to the non-primary location when none is flagged primary", () => {
    const jsonLd = buildMerchantJsonLd(
      detail({ locations: [location({ isPrimary: false, city: "Mombasa" })] }),
      PROFILE_URL
    )!;
    expect((jsonLd.address as Record<string, string>).addressLocality).toBe("Mombasa");
  });

  it("dedupes images and caps the list", () => {
    const jsonLd = buildMerchantJsonLd(
      detail({
        bannerUrl: "https://cdn.example.com/a.png",
        logoUrl: "https://cdn.example.com/a.png",
        merchantMedia: Array.from({ length: 10 }, (_, i) => ({
          id: `media-${i}`,
          kind: "business" as const,
          imageUrl: `https://cdn.example.com/m${i}.png`,
          thumbnailUrl: `https://cdn.example.com/t${i}.png`,
          altText: "Shopfront",
          title: null,
        })),
      }),
      PROFILE_URL
    )!;
    const images = jsonLd.image as string[];
    expect(images[0]).toBe("https://cdn.example.com/a.png");
    expect(new Set(images).size).toBe(images.length);
    expect(images).toHaveLength(6);
  });
});
