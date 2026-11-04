/**
 * Wire contract for the public directory API (`/api/public/directory/*`),
 * which the marketing site renders `www.akibamiles.com/shops` from.
 *
 * SOURCE OF TRUTH for that shape. `packages/website/src/lib/directory/types.ts`
 * declares a matching type by hand — the marketing site can't depend on this
 * Next app — so a change here needs a change there, and the contract test
 * beside this file is what makes a silent divergence fail the build.
 *
 * Deliberately NOT the /api/v1 contract the native app uses. v1 is frozen
 * against released binaries that parse it with a strict schema, and it
 * actively *withholds* data for client compatibility (see
 * percentFundedOffersV1Flag / multiMerchantFundedOffersV1Flag) — a web page
 * reading v1 would silently omit percentage and multi-merchant offers.
 *
 * Three things are deliberately absent:
 *
 * - Customer visit photos. Those are the only URLs in the projection that are
 *   signed and expire (15 minutes), so including them would make every
 *   response uncacheable and would bake expiring URLs into server-rendered,
 *   CDN-cached HTML. The textual half of a verified visit — favourite order
 *   and experience labels — is what search engines read, and it stays.
 * - Akiba-funded offers. They carry country eligibility and a real-money
 *   claim flow; the directory links to the Pass app for those.
 * - Internal merchant ids. The marketing site never needs them.
 */
import type {
  OperatingModel,
  OpeningHours,
  PublicMerchantDetail,
  PublicMerchantSummary,
} from "./types";

export type DirectoryCategory = { slug: string; name: string };

export type DirectoryMerchantSummary = {
  slug: string;
  name: string;
  shortDescription: string | null;
  logoUrl: string | null;
  primaryCategory: DirectoryCategory | null;
  categories: DirectoryCategory[];
  operatingModel: OperatingModel;
  primaryLocation: { locality: string | null; city: string } | null;
  branchCount: number;
  voucherCount: number;
};

export type DirectoryLocation = {
  id: string;
  name: string;
  streetAddress: string;
  landmark: string | null;
  locality: string | null;
  city: string;
  countyOrRegion: string | null;
  postalCode: string | null;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  directionsUrl: string;
  timezone: string;
  openingHours: OpeningHours;
  isPrimary: boolean;
  acceptsAkibaPass: boolean;
  acceptsVouchers: boolean;
};

export type DirectoryMedia = {
  kind: "business" | "product";
  imageUrl: string;
  thumbnailUrl: string;
  altText: string;
  title: string | null;
};

export type DirectoryOffer = {
  title: string;
  description: string;
  terms: string | null;
  schedule: "always" | "weekly";
  daysOfWeek: number[];
  startTime: string | null;
  endTime: string | null;
  startsOn: string | null;
  endsOn: string | null;
  timezone: string;
  imageUrl: string | null;
};

export type DirectoryVoucher = {
  title: string;
  voucherType: "free" | "percent_off" | "fixed_off";
  milesCost: number;
  discountPercent: number | null;
  discountCusd: number | null;
  retailValueCusd: number | null;
  expiresAt: string | null;
  /** null = every branch. */
  branchIds: string[] | null;
};

/** Textual half of an approved verified visit; photos are excluded by design. */
export type DirectoryVerifiedVisit = {
  favoriteOrder: string | null;
  experienceLabels: string[];
};

export type DirectoryMerchantProfile = DirectoryMerchantSummary & {
  description: string | null;
  bannerUrl: string | null;
  websiteUrl: string | null;
  contacts: {
    phone: string | null;
    email: string | null;
    whatsapp: string | null;
    instagram: string | null;
    facebook: string | null;
  };
  locations: DirectoryLocation[];
  coreOfferings: Array<{ name: string; description: string | null }>;
  media: DirectoryMedia[];
  offers: DirectoryOffer[];
  vouchers: DirectoryVoucher[];
  verifiedVisits: DirectoryVerifiedVisit[];
  verifiedVisitFavoriteProduct: string | null;
};

export type DirectoryListResponse = {
  merchants: DirectoryMerchantSummary[];
  nextCursor: string | null;
};

export type DirectoryProfileResponse = {
  merchant: DirectoryMerchantProfile;
};

export function toDirectorySummary(merchant: PublicMerchantSummary): DirectoryMerchantSummary {
  return {
    slug: merchant.slug,
    name: merchant.name,
    shortDescription: merchant.shortDescription,
    logoUrl: merchant.logoUrl,
    primaryCategory: merchant.primaryCategory,
    categories: merchant.categories,
    operatingModel: merchant.operatingModel,
    primaryLocation: merchant.primaryLocation
      ? { locality: merchant.primaryLocation.locality, city: merchant.primaryLocation.city }
      : null,
    branchCount: merchant.branchCount,
    voucherCount: merchant.voucherCount,
  };
}

/**
 * `formatStreetAddress` and `buildDirectionsUrl` are injected rather than
 * imported so this module stays a pure mapping with no transitive pull on
 * request-scoped helpers.
 */
export function toDirectoryProfile(
  merchant: PublicMerchantDetail,
  helpers: {
    streetAddress: (location: PublicMerchantDetail["locations"][number]) => string;
    directionsUrl: (location: PublicMerchantDetail["locations"][number]) => string;
  }
): DirectoryMerchantProfile {
  return {
    ...toDirectorySummary(merchant),
    description: merchant.description,
    bannerUrl: merchant.bannerUrl,
    websiteUrl: merchant.websiteUrl,
    contacts: {
      phone: merchant.contacts.phone,
      email: merchant.contacts.email,
      whatsapp: merchant.contacts.whatsapp,
      instagram: merchant.contacts.instagram,
      facebook: merchant.contacts.facebook,
    },
    locations: merchant.locations.map((location) => ({
      id: location.id,
      name: location.name,
      streetAddress: helpers.streetAddress(location),
      landmark: location.landmark,
      locality: location.locality,
      city: location.city,
      countyOrRegion: location.countyOrRegion,
      postalCode: location.postalCode,
      countryCode: location.countryCode,
      latitude: location.latitude,
      longitude: location.longitude,
      directionsUrl: helpers.directionsUrl(location),
      timezone: location.timezone,
      openingHours: location.openingHours,
      isPrimary: location.isPrimary,
      acceptsAkibaPass: location.acceptsAkibaPass,
      acceptsVouchers: location.acceptsVouchers,
    })),
    coreOfferings: merchant.coreOfferings.map(({ name, description }) => ({ name, description })),
    media: merchant.merchantMedia.map((item) => ({
      kind: item.kind,
      imageUrl: item.imageUrl,
      thumbnailUrl: item.thumbnailUrl,
      altText: item.altText,
      title: item.title,
    })),
    offers: merchant.offers.map((offer) => ({
      title: offer.title,
      description: offer.description,
      terms: offer.terms,
      schedule: offer.schedule,
      daysOfWeek: offer.daysOfWeek,
      startTime: offer.startTime,
      endTime: offer.endTime,
      startsOn: offer.startsOn,
      endsOn: offer.endsOn,
      timezone: offer.timezone,
      imageUrl: offer.imageUrl,
    })),
    vouchers: merchant.vouchers.map((voucher) => ({
      title: voucher.title,
      voucherType: voucher.voucherType,
      milesCost: voucher.milesCost,
      discountPercent: voucher.discountPercent,
      discountCusd: voucher.discountCusd,
      retailValueCusd: voucher.retailValueCusd,
      expiresAt: voucher.expiresAt,
      branchIds: voucher.branchIds,
    })),
    verifiedVisits: merchant.verifiedVisits.map((visit) => ({
      favoriteOrder: visit.favoriteOrder,
      experienceLabels: visit.experienceLabels,
    })),
    verifiedVisitFavoriteProduct: merchant.verifiedVisitFavoriteProduct,
  };
}
