/**
 * Structured data is the part of these pages nobody reviews by eye, so the
 * properties worth locking are the ones that would be wrong silently: a
 * rating we never collected, a duplicated city in the address, an `@id` that
 * disagrees with the canonical tag, and merchant copy escaping the script tag.
 */
import { describe, it, expect } from "vitest";
import {
  buildBreadcrumbJsonLd,
  buildShopJsonLd,
  serializeJsonLd,
} from "@/lib/directory/seo";
import type { DirectoryLocation, DirectoryMerchantProfile } from "@/lib/directory/types";

const SITE_URL = "https://www.akibamiles.com";
const CANONICAL = `${SITE_URL}/shops/arabica-coffee-house`;

const DESCRIPTION =
  "A specialty coffee roastery on Ngong Road serving single-origin Kenyan beans and all-day breakfast.";

function location(overrides: Partial<DirectoryLocation> = {}): DirectoryLocation {
  return {
    id: "l1",
    name: "Kilimani",
    streetAddress: "Ngong Road, Adlife Plaza, Kilimani",
    landmark: "Opposite the mall",
    locality: "Kilimani",
    city: "Nairobi",
    countyOrRegion: "Nairobi County",
    postalCode: "00100",
    countryCode: "KE",
    latitude: -1.3,
    longitude: 36.78,
    directionsUrl: "https://www.google.com/maps/search/?api=1&query=-1.3,36.78",
    timezone: "Africa/Nairobi",
    openingHours: { version: 1, monday: [{ opens: "07:00", closes: "19:00" }] },
    isPrimary: true,
    acceptsAkibaPass: true,
    acceptsVouchers: true,
    ...overrides,
  };
}

function profile(overrides: Partial<DirectoryMerchantProfile> = {}): DirectoryMerchantProfile {
  return {
    slug: "arabica-coffee-house",
    name: "Arabica Coffee House",
    shortDescription: DESCRIPTION,
    logoUrl: "https://cdn.example.com/logo.png",
    primaryCategory: { slug: "coffee", name: "Coffee shop" },
    categories: [{ slug: "coffee", name: "Coffee shop" }],
    operatingModel: "physical",
    primaryLocation: { locality: "Kilimani", city: "Nairobi" },
    branchCount: 1,
    voucherCount: 1,
    description: DESCRIPTION,
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
    media: [],
    offers: [],
    vouchers: [],
    verifiedVisits: [],
    verifiedVisitFavoriteProduct: null,
    ...overrides,
  };
}

describe("buildShopJsonLd", () => {
  it("names the canonical URL as both url and @id", () => {
    // A mismatch here describes a different page from the canonical tag.
    const jsonLd = buildShopJsonLd(profile(), CANONICAL)!;
    expect(jsonLd["@id"]).toBe(CANONICAL);
    expect(jsonLd.url).toBe(CANONICAL);
    expect(jsonLd["@type"]).toBe("LocalBusiness");
  });

  it("does not repeat the city inside streetAddress", () => {
    const address = buildShopJsonLd(profile(), CANONICAL)!.address as Record<string, string>;
    expect(address.addressLocality).toBe("Nairobi");
    expect(address.streetAddress).not.toContain("Nairobi");
  });

  it("carries region and postal code when supplied, and omits them when not", () => {
    const withBoth = buildShopJsonLd(profile(), CANONICAL)!.address as Record<string, unknown>;
    expect(withBoth).toMatchObject({ addressRegion: "Nairobi County", postalCode: "00100" });

    const without = buildShopJsonLd(
      profile({ locations: [location({ countyOrRegion: null, postalCode: null })] }),
      CANONICAL
    )!.address as Record<string, unknown>;
    expect(without).not.toHaveProperty("addressRegion");
    expect(without).not.toHaveProperty("postalCode");
  });

  it("maps opening hours to schema.org specifications", () => {
    const jsonLd = buildShopJsonLd(profile(), CANONICAL)!;
    expect(jsonLd.openingHoursSpecification).toEqual([
      {
        "@type": "OpeningHoursSpecification",
        dayOfWeek: "https://schema.org/Monday",
        opens: "07:00",
        closes: "19:00",
      },
    ]);
  });

  it("omits openingHoursSpecification entirely when hours are unknown", () => {
    const jsonLd = buildShopJsonLd(
      profile({ locations: [location({ openingHours: {} })] }),
      CANONICAL
    )!;
    expect(jsonLd).not.toHaveProperty("openingHoursSpecification");
  });

  it("collects website and socials into sameAs, skipping blanks", () => {
    expect(buildShopJsonLd(profile(), CANONICAL)!.sameAs).toEqual([
      "https://arabica.co.ke",
      "https://instagram.com/arabica",
    ]);
  });

  it("omits sameAs when there is nothing to link", () => {
    const jsonLd = buildShopJsonLd(
      profile({
        websiteUrl: null,
        contacts: { phone: null, email: null, whatsapp: null, instagram: null, facebook: null },
      }),
      CANONICAL
    )!;
    expect(jsonLd).not.toHaveProperty("sameAs");
  });

  it("never emits a rating — verified visits carry no rating value", () => {
    const jsonLd = buildShopJsonLd(
      profile({
        verifiedVisits: [{ favoriteOrder: "Flat white", experienceLabels: ["Quick service"] }],
        verifiedVisitFavoriteProduct: "Flat white",
      }),
      CANONICAL
    )!;
    expect(jsonLd).not.toHaveProperty("aggregateRating");
    expect(jsonLd).not.toHaveProperty("review");
    expect(jsonLd).not.toHaveProperty("ratingValue");
  });

  it("includes merchant-run offers but never Miles-priced vouchers", () => {
    const jsonLd = buildShopJsonLd(
      profile({
        offers: [
          {
            title: "Two-for-one Tuesdays",
            description: "Buy one coffee, get one free.",
            terms: null,
            schedule: "weekly",
            daysOfWeek: [2],
            startTime: null,
            endTime: null,
            startsOn: "2026-01-01",
            endsOn: "2026-06-30",
            timezone: "Africa/Nairobi",
            imageUrl: null,
          },
        ],
        vouchers: [
          {
            title: "Free pastry",
            voucherType: "free",
            milesCost: 250,
            discountPercent: null,
            discountCusd: null,
            retailValueCusd: 2,
            expiresAt: null,
            branchIds: null,
          },
        ],
      }),
      CANONICAL
    )!;

    expect(jsonLd.makesOffer).toEqual([
      {
        "@type": "Offer",
        name: "Two-for-one Tuesdays",
        description: "Buy one coffee, get one free.",
        availabilityStarts: "2026-01-01",
        availabilityEnds: "2026-06-30",
      },
    ]);
    expect(JSON.stringify(jsonLd)).not.toContain("Free pastry");
  });

  it("describes an online-only merchant as an Organization with no address", () => {
    const jsonLd = buildShopJsonLd(
      profile({ operatingModel: "online", locations: [], primaryLocation: null }),
      CANONICAL
    )!;
    expect(jsonLd["@type"]).toBe("Organization");
    expect(jsonLd).not.toHaveProperty("address");
  });

  it("returns null for a physical merchant with no location", () => {
    expect(buildShopJsonLd(profile({ locations: [] }), CANONICAL)).toBeNull();
  });

  it("falls back to a non-primary location when none is flagged primary", () => {
    const jsonLd = buildShopJsonLd(
      profile({ locations: [location({ isPrimary: false, city: "Mombasa" })] }),
      CANONICAL
    )!;
    expect((jsonLd.address as Record<string, string>).addressLocality).toBe("Mombasa");
  });

  it("dedupes images and caps the list at six", () => {
    const jsonLd = buildShopJsonLd(
      profile({
        bannerUrl: "https://cdn.example.com/a.png",
        logoUrl: "https://cdn.example.com/a.png",
        media: Array.from({ length: 10 }, (_, i) => ({
          kind: "business" as const,
          imageUrl: `https://cdn.example.com/m${i}.png`,
          thumbnailUrl: `https://cdn.example.com/t${i}.png`,
          altText: "Shopfront",
          title: null,
        })),
      }),
      CANONICAL
    )!;
    const images = jsonLd.image as string[];
    expect(images).toHaveLength(6);
    expect(new Set(images).size).toBe(images.length);
  });
});

describe("buildBreadcrumbJsonLd", () => {
  it("puts the shop under the directory, not at the site root", () => {
    // This is what makes a profile part of the site's structure rather than
    // a page reachable only from search.
    expect(buildBreadcrumbJsonLd(profile(), SITE_URL)).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Shops", item: `${SITE_URL}/shops` },
        {
          "@type": "ListItem",
          position: 2,
          name: "Arabica Coffee House",
          item: CANONICAL,
        },
      ],
    });
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so merchant copy can't break out of the script tag", () => {
    const serialized = serializeJsonLd(
      buildShopJsonLd(profile({ description: "Closing </script><script>alert(1)" }), CANONICAL)!
    );
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script");
  });

  it("round-trips to the same object", () => {
    const jsonLd = buildShopJsonLd(profile(), CANONICAL)!;
    expect(JSON.parse(serializeJsonLd(jsonLd))).toEqual(jsonLd);
  });
});
