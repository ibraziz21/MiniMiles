import { formatStreetAddress } from "./directions";
import { toOpeningHoursSpecification } from "./opening-hours";
import type {
  PublicMerchantDetail,
  PublicMerchantLocation,
  PublicMerchantSummary,
} from "./types";

/**
 * A profile shorter than this is a stub: the merchant's information pack
 * hasn't landed yet, so there is nothing on the page that a search result
 * could usefully answer.
 */
export const MIN_SHORT_DESCRIPTION_CHARS = 80;

/**
 * Whether a profile is substantial enough to put in front of search engines.
 *
 * Thin, near-identical directory entries are what Google's spam systems
 * target, and a handful of them drags the whole directory's assessment down —
 * so an incomplete profile is served to people as usual but kept out of both
 * the sitemap and the index until it has real content.
 *
 * Deliberately gated on description, imagery and location rather than on
 * having a live offer: a well-described shop with no current promotion is a
 * perfectly good search result, and offers come and go week to week.
 *
 * Takes the summary shape so the sitemap (which only ever loads summaries)
 * and the profile page apply exactly the same rule and cannot disagree —
 * a sitemap full of URLs that then serve `noindex` is itself a Search
 * Console error.
 */
export function isProfileIndexable(merchant: PublicMerchantSummary): boolean {
  const described =
    (merchant.shortDescription ?? "").trim().length >= MIN_SHORT_DESCRIPTION_CHARS;
  const illustrated = Boolean(merchant.logoUrl);
  const locatable = merchant.operatingModel === "online" || merchant.primaryLocation !== null;
  return described && illustrated && locatable;
}

function postalAddress(location: PublicMerchantLocation): Record<string, unknown> {
  const address: Record<string, unknown> = {
    "@type": "PostalAddress",
    streetAddress: formatStreetAddress(location),
    addressLocality: location.city,
    addressCountry: location.countryCode,
  };
  if (location.countyOrRegion) address.addressRegion = location.countyOrRegion;
  if (location.postalCode) address.postalCode = location.postalCode;
  return address;
}

/** Cap the image array so one media-heavy merchant can't bloat every crawl. */
const MAX_JSONLD_IMAGES = 6;

function images(merchant: PublicMerchantDetail): string[] {
  const candidates = [
    merchant.bannerUrl,
    merchant.logoUrl,
    ...merchant.merchantMedia.map((m) => m.imageUrl),
  ].filter((url): url is string => Boolean(url));
  return Array.from(new Set(candidates)).slice(0, MAX_JSONLD_IMAGES);
}

/**
 * Merchant-run promotions only. Vouchers are deliberately excluded: they are
 * priced in Miles, which is not a currency schema.org can express, and a
 * priceless `Offer` next to a real one reads as a missing price rather than
 * as a different kind of thing.
 */
function makesOffer(merchant: PublicMerchantDetail): Record<string, unknown>[] {
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
 * Structured data for a merchant profile, built only from fields that
 * `get_public_merchant` already exposes publicly.
 *
 * Note there is intentionally no `aggregateRating` or `review`: verified
 * visits carry a favourite item, experience labels and photos, but no rating
 * value and no review text, so there is nothing to derive a rating from.
 * Emitting one would mean inventing it.
 */
export function buildMerchantJsonLd(
  merchant: PublicMerchantDetail,
  canonicalUrl: string
): Record<string, unknown> | null {
  const primary = merchant.locations.find((l) => l.isPrimary) ?? merchant.locations[0] ?? null;
  const onlineOnly = merchant.operatingModel === "online";

  // A physical merchant with no location would produce a LocalBusiness with
  // no address, which is worse than no structured data at all.
  if (!primary && !onlineOnly) return null;

  // Takes the canonical URL rather than an origin: the hub serves this
  // profile, but once the directory is relocated the canonical lives on the
  // marketing site, and `@id` must name the same URL as the canonical tag or
  // the two describe different things.
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
