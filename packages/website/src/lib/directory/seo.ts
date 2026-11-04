import { toOpeningHoursSpecification } from "./hours";
import type { DirectoryLocation, DirectoryMerchantProfile } from "./types";

/** Cap the image array so one media-heavy merchant can't bloat every crawl. */
const MAX_JSONLD_IMAGES = 6;

function postalAddress(location: DirectoryLocation): Record<string, unknown> {
  const address: Record<string, unknown> = {
    "@type": "PostalAddress",
    // Already a street line without the city — the API builds it that way, so
    // `addressLocality` below isn't a repeat.
    streetAddress: location.streetAddress,
    addressLocality: location.city,
    addressCountry: location.countryCode,
  };
  if (location.countyOrRegion) address.addressRegion = location.countyOrRegion;
  if (location.postalCode) address.postalCode = location.postalCode;
  return address;
}

function images(merchant: DirectoryMerchantProfile): string[] {
  const candidates = [
    merchant.bannerUrl,
    merchant.logoUrl,
    ...merchant.media.map((m) => m.imageUrl),
  ].filter((url): url is string => Boolean(url));
  return Array.from(new Set(candidates)).slice(0, MAX_JSONLD_IMAGES);
}

/**
 * Merchant-run promotions only. Vouchers are excluded: they are priced in
 * Miles, which is not a currency schema.org can express, and a priceless
 * `Offer` beside a real one reads as a missing price rather than as a
 * different kind of thing.
 */
function makesOffer(merchant: DirectoryMerchantProfile): Record<string, unknown>[] {
  return merchant.offers.map((offer) => {
    const entry: Record<string, unknown> = {
      "@type": "Offer",
      name: offer.title,
      description: offer.description,
    };
    if (offer.startsOn) entry.availabilityStarts = offer.startsOn;
    if (offer.endsOn) entry.availabilityEnds = offer.endsOn;
    return entry;
  });
}

/**
 * Structured data for a shop profile.
 *
 * There is intentionally no `aggregateRating` or `review`. Verified visits
 * carry a favourite item and experience labels but no rating value and no
 * review text, so there is nothing to derive a rating from — emitting one
 * would mean inventing it, which is both a structured-data policy violation
 * and a claim we can't stand behind.
 */
export function buildShopJsonLd(
  merchant: DirectoryMerchantProfile,
  canonicalUrl: string
): Record<string, unknown> | null {
  const primary = merchant.locations.find((l) => l.isPrimary) ?? merchant.locations[0] ?? null;
  const onlineOnly = merchant.operatingModel === "online";

  // A physical merchant with no location would produce a LocalBusiness with
  // no address, which is worse than no structured data at all.
  if (!primary && !onlineOnly) return null;

  const jsonLd: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": primary ? "LocalBusiness" : "Organization",
    "@id": canonicalUrl,
    name: merchant.name,
    url: canonicalUrl,
  };

  const description = merchant.description?.trim() || merchant.shortDescription?.trim();
  if (description) jsonLd.description = description;

  const imageUrls = images(merchant);
  if (imageUrls.length > 0) jsonLd.image = imageUrls;
  if (merchant.logoUrl) jsonLd.logo = merchant.logoUrl;

  if (merchant.contacts.phone) jsonLd.telephone = merchant.contacts.phone;
  if (merchant.contacts.email) jsonLd.email = merchant.contacts.email;

  const sameAs = [
    merchant.websiteUrl,
    merchant.contacts.instagram,
    merchant.contacts.facebook,
  ].filter((link): link is string => Boolean(link));
  if (sameAs.length > 0) jsonLd.sameAs = sameAs;

  if (merchant.primaryCategory) jsonLd.additionalType = merchant.primaryCategory.name;

  if (primary) {
    jsonLd.address = postalAddress(primary);
    if (primary.latitude != null && primary.longitude != null) {
      jsonLd.geo = {
        "@type": "GeoCoordinates",
        latitude: primary.latitude,
        longitude: primary.longitude,
      };
    }
    const hours = toOpeningHoursSpecification(primary.openingHours);
    if (hours.length > 0) jsonLd.openingHoursSpecification = hours;
    jsonLd.areaServed = primary.city;
  }

  const offers = makesOffer(merchant);
  if (offers.length > 0) jsonLd.makesOffer = offers;

  return jsonLd;
}

/**
 * Breadcrumbs for a profile. The directory listing is the parent, which is
 * what makes a shop profile part of this site's structure rather than an
 * orphan page reachable only from search.
 */
export function buildBreadcrumbJsonLd(
  merchant: DirectoryMerchantProfile,
  siteUrl: string
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Shops", item: `${siteUrl}/shops` },
      {
        "@type": "ListItem",
        position: 2,
        name: merchant.name,
        item: `${siteUrl}/shops/${merchant.slug}`,
      },
    ],
  };
}

/** Escapes `<` so a stray sequence in merchant copy can't break out of the script tag. */
export function serializeJsonLd(jsonLd: Record<string, unknown>): string {
  return JSON.stringify(jsonLd).replace(/</g, "\\u003c");
}
