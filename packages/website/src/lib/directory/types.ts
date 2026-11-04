/**
 * Wire shape of the Pass app's public directory API.
 *
 * Hand-mirrored from
 * `packages/hub-page/src/lib/merchants/publicDirectoryContract.ts`, which is
 * the source of truth — this site can't depend on that Next app, so the two
 * are kept in step by hand. A contract test lives beside the hub module; if
 * you change a field name here, change it there too.
 *
 * Note what the contract deliberately omits, so nothing here waits for it:
 * customer visit photos (the only signed, expiring URLs in the projection,
 * excluded so responses stay cacheable), Akiba-funded offers (country
 * eligibility and a real-money claim flow belong in the Pass app), and
 * internal merchant ids.
 */

export type OperatingModel = "physical" | "hybrid" | "online";

export type DirectoryCategory = { slug: string; name: string };

export type OpeningHoursRange = { opens: string; closes: string };

export type OpeningHours = {
  version?: number;
  monday?: OpeningHoursRange[];
  tuesday?: OpeningHoursRange[];
  wednesday?: OpeningHoursRange[];
  thursday?: OpeningHoursRange[];
  friday?: OpeningHoursRange[];
  saturday?: OpeningHoursRange[];
  sunday?: OpeningHoursRange[];
  notes?: string;
};

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
