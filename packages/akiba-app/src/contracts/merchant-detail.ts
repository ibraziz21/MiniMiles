import { z } from 'zod';

import { fundedOfferSchema } from './vouchers';

// Source: GET /api/v1/merchants/:slug (public) and
// GET /api/v1/me/merchant-state/:slug (self-only), both in
// src/app/api/v1/merchants/[slug]/ and src/app/api/v1/me/merchant-state/[slug]/.
// Mirrors PublicMerchantDetail because the native screen now ports the
// complete Hub profile: identity, verified visits, business gallery,
// vouchers and branches.
export const publicVoucherSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  voucherType: z.enum(['free', 'percent_off', 'fixed_off']),
  milesCost: z.number(),
  discountPercent: z.number().nullable(),
  discountCusd: z.number().nullable(),
  applicableCategory: z.string().nullable(),
  linkedProductId: z.string().nullable(),
  retailValueCusd: z.number().nullable(),
  cooldownSeconds: z.number(),
  globalCap: z.number().nullable(),
  expiresAt: z.string().nullable(),
  branchIds: z.array(z.string()).nullable(),
});

export type PublicVoucherSummary = z.infer<typeof publicVoucherSummarySchema>;

const openingHoursRangeSchema = z.object({ opens: z.string(), closes: z.string() });
const openingHoursSchema = z.object({
  version: z.number().optional(),
  monday: z.array(openingHoursRangeSchema).optional(),
  tuesday: z.array(openingHoursRangeSchema).optional(),
  wednesday: z.array(openingHoursRangeSchema).optional(),
  thursday: z.array(openingHoursRangeSchema).optional(),
  friday: z.array(openingHoursRangeSchema).optional(),
  saturday: z.array(openingHoursRangeSchema).optional(),
  sunday: z.array(openingHoursRangeSchema).optional(),
  notes: z.string().optional(),
});

const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  locationType: z.enum(['store', 'office', 'pickup_point', 'service_centre']),
  addressLine1: z.string(),
  addressLine2: z.string().nullable(),
  building: z.string().nullable(),
  floorOrUnit: z.string().nullable(),
  landmark: z.string().nullable(),
  locality: z.string().nullable(),
  city: z.string(),
  countyOrRegion: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  mapsUrl: z.string().nullable(),
  publicPhone: z.string().nullable(),
  publicEmail: z.string().nullable(),
  publicWhatsapp: z.string().nullable(),
  timezone: z.string(),
  openingHours: openingHoursSchema,
  isPrimary: z.boolean(),
  acceptsAkibaPass: z.boolean(),
  acceptsVouchers: z.boolean(),
});

const customerPhotoSchema = z.object({
  id: z.string(),
  visitId: z.string().nullable(),
  thumbnailUrl: z.string(),
  displayUrl: z.string(),
  altText: z.string(),
  itemLabel: z.string().nullable(),
});

const verifiedVisitSchema = z.object({
  id: z.string(),
  experienceLabels: z.array(z.string()),
  photos: z.array(customerPhotoSchema),
});

const merchantMediaSchema = z.object({
  id: z.string(),
  kind: z.enum(['business', 'product']),
  imageUrl: z.string(),
  thumbnailUrl: z.string(),
  altText: z.string(),
  title: z.string().nullable(),
});

export const merchantDetailSchema = z.object({
  merchant: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    shortDescription: z.string().nullable(),
    description: z.string().nullable(),
    logoUrl: z.string().nullable(),
    bannerUrl: z.string().nullable(),
    websiteUrl: z.string().nullable(),
    primaryCategory: z.object({ slug: z.string(), name: z.string() }).nullable(),
    categories: z.array(z.object({ slug: z.string(), name: z.string() })),
    operatingModel: z.enum(['physical', 'hybrid', 'online']),
    primaryLocation: z.object({
      id: z.string(),
      locality: z.string().nullable(),
      city: z.string(),
      latitude: z.number().nullable(),
      longitude: z.number().nullable(),
    }).nullable(),
    branchCount: z.number(),
    voucherCount: z.number(),
    contacts: z.object({
      phone: z.string().nullable(),
      email: z.string().nullable(),
      whatsapp: z.string().nullable(),
      instagram: z.string().nullable(),
      facebook: z.string().nullable(),
    }),
    locations: z.array(locationSchema),
    coreOfferings: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().nullable() })),
    merchantMedia: z.array(merchantMediaSchema),
    verifiedVisits: z.array(verifiedVisitSchema),
    approvedCustomerPhotos: z.array(customerPhotoSchema),
  }),
  vouchers: z.array(publicVoucherSummarySchema),
  fundedOffers: z.array(fundedOfferSchema),
});

export type MerchantDetail = z.infer<typeof merchantDetailSchema>;
export type MerchantLocation = z.infer<typeof locationSchema>;
export type MerchantMedia = z.infer<typeof merchantMediaSchema>;
export type CustomerPhoto = z.infer<typeof customerPhotoSchema>;
export type VerifiedVisit = z.infer<typeof verifiedVisitSchema>;

export const memberVerifiedVisitSchema = z.object({
  id: z.string(),
  submittedAt: z.string(),
  recommendation: z.enum(['recommended', 'not_recommended', 'skipped']),
  photoState: z.enum(['none', 'under_review', 'approved', 'not_approved']),
});

export type MemberVerifiedVisit = z.infer<typeof memberVerifiedVisitSchema>;

export const merchantStateDetailSchema = z.object({
  balance: z.number().nullable(),
  saved: z.boolean(),
  claimedFundedAllocationIds: z.array(z.string()),
  verifiedVisit: memberVerifiedVisitSchema.nullable(),
  openContributionRequest: z.boolean(),
});

export type MerchantStateDetail = z.infer<typeof merchantStateDetailSchema>;
