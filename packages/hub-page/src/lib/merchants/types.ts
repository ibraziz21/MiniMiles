export type OperatingModel = "physical" | "hybrid" | "online";

export type PublicMerchantCategory = { slug: string; name: string };

export type PublicMerchantLocation = {
  id: string;
  name: string;
  locationType: "store" | "office" | "pickup_point" | "service_centre";
  addressLine1: string;
  addressLine2: string | null;
  building: string | null;
  floorOrUnit: string | null;
  landmark: string | null;
  locality: string | null;
  city: string;
  countyOrRegion: string | null;
  postalCode: string | null;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
  mapsUrl: string | null;
  publicPhone: string | null;
  publicEmail: string | null;
  publicWhatsapp: string | null;
  timezone: string;
  openingHours: OpeningHours;
  isPrimary: boolean;
  acceptsAkibaPass: boolean;
  acceptsVouchers: boolean;
};

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

export type PublicVoucherSummary = {
  id: string;
  title: string;
  voucherType: "free" | "percent_off" | "fixed_off";
  milesCost: number;
  discountPercent: number | null;
  discountCusd: number | null;
  applicableCategory: string | null;
  linkedProductId: string | null;
  retailValueCusd: number | null;
  cooldownSeconds: number;
  globalCap: number | null;
  expiresAt: string | null;
  branchIds: string[] | null; // null = available at all branches
};

/**
 * Merchant-authored media is useful context, never verified customer proof.
 * `kind` keeps business/location imagery distinct from product imagery without
 * exposing catalogue, price or inventory fields to the public profile.
 */
export type PublicMerchantMedia = {
  id: string;
  kind: "business" | "product";
  imageUrl: string;
  thumbnailUrl: string;
  altText: string;
  title: string | null;
};

/** Approved derivatives from verified post-purchase visits. */
export type PublicCustomerPhoto = {
  id: string;
  visitId: string | null;
  thumbnailUrl: string;
  displayUrl: string;
  altText: string;
  itemLabel: string | null;
};

/** Anonymous, structured recommendation backed by an active verified visit. */
export type PublicVerifiedVisit = {
  id: string;
  experienceLabels: string[];
  photos: PublicCustomerPhoto[];
};

/** Private confirmation shown only to the signed-in contributing member. */
export type MemberVerifiedVisitSummary = {
  id: string;
  submittedAt: string;
  recommendation: "recommended" | "not_recommended" | "skipped";
  photoState: "none" | "under_review" | "approved" | "not_approved";
};

export type PublicMerchantSummary = {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  logoUrl: string | null;
  primaryCategory: PublicMerchantCategory | null;
  categories: PublicMerchantCategory[];
  operatingModel: OperatingModel;
  primaryLocation: {
    id: string;
    locality: string | null;
    city: string;
    latitude: number | null;
    longitude: number | null;
  } | null;
  branchCount: number;
  voucherCount: number;
  distanceKm: number | null;
};

export type PublicMerchantDetail = PublicMerchantSummary & {
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
  locations: PublicMerchantLocation[];
  coreOfferings: Array<{ id: string; name: string; description: string | null }>;
  merchantMedia: PublicMerchantMedia[];
  verifiedVisits: PublicVerifiedVisit[];
  approvedCustomerPhotos: PublicCustomerPhoto[];
  vouchers: PublicVoucherSummary[];
};

export type MerchantDirectoryResponse = {
  merchants: PublicMerchantSummary[];
  next_cursor: string | null;
  applied: {
    category: string | null;
    city: string | null;
    nearby: boolean;
  };
};
