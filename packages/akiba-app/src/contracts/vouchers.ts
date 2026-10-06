import { z } from 'zod';

import { claimFrictionSchema } from './voucher-purchase';

// Source: hub-page's GET /api/v1/vouchers (src/app/api/v1/vouchers/route.ts)
// and GET /api/v1/me/voucher-state (src/app/api/v1/me/voucher-state/route.ts).
// Note the casing mismatch is real, not a typo: VoucherTemplate
// (src/lib/vouchers/catalogue.server.ts) is a thin, direct DB projection
// that was never remapped to camelCase, while FundedOffer
// (src/components/vouchers/FundedOfferCard.tsx) already is.
export const voucherTemplateSchema = z.object({
  id: z.string(),
  title: z.string(),
  voucher_type: z.enum(['free', 'percent_off', 'fixed_off']),
  miles_cost: z.number(),
  discount_percent: z.number().nullable(),
  discount_cusd: z.number().nullable(),
  applicable_category: z.string().nullable(),
  retail_value_cusd: z.number().nullable(),
  partners: z
    .object({
      id: z.string(),
      slug: z.string(),
      name: z.string(),
      image_url: z.string().nullable(),
    })
    .nullable(),
});

export type VoucherTemplate = z.infer<typeof voucherTemplateSchema>;

export const fundedOfferSchema = z.object({
  allocationId: z.string(),
  title: z.string(),
  discountKes: z.number(),
  minimumSpendKes: z.number(),
  terms: z.string().nullable(),
  eligibilitySummary: z.string().nullable(),
  claimEndsAt: z.string(),
  merchant: z.object({ name: z.string(), slug: z.string(), imageUrl: z.string().nullable() }),
});

export type FundedOffer = z.infer<typeof fundedOfferSchema>;

export const voucherCatalogueSchema = z.object({
  templates: z.array(voucherTemplateSchema),
  fundedOffers: z.array(fundedOfferSchema),
});

export type VoucherCatalogue = z.infer<typeof voucherCatalogueSchema>;

// Source: hub-page's LoyaltyOffer/LoyaltyQualificationOutcome
// (src/components/vouchers/LoyaltyVoucherCard.tsx), returned in full by
// GET /api/v1/me/voucher-state since there's no anonymous/public
// projection of a loyalty offer to compose against instead.
export const loyaltyQualificationOutcomeSchema = z.object({
  type: z.enum(['merchant_purchase_count', 'merchant_net_spend_kes']),
  minimum: z.number(),
  actual: z.number().nullable(),
  satisfied: z.boolean(),
});

export type LoyaltyQualificationOutcome = z.infer<typeof loyaltyQualificationOutcomeSchema>;

export const loyaltyOfferSchema = z.object({
  templateId: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  voucherType: z.enum(['free', 'percent_off', 'fixed_off', 'bogo']),
  discountPercent: z.number().nullable(),
  discountKes: z.number().nullable(),
  retailValueKes: z.number().nullable(),
  minimumSpendKes: z.number().nullable(),
  maximumDiscountKes: z.number().nullable(),
  merchant: z.object({ id: z.string(), name: z.string(), slug: z.string(), imageUrl: z.string().nullable() }),
  accessPolicy: z.enum(['public', 'loyalty_qualified']),
  acquisitionMode: z.enum(['miles', 'free']),
  milesCost: z.number(),
  qualificationMode: z.enum(['any', 'all']).nullable(),
  customerCopy: z.string().nullable(),
  progress: z.array(loyaltyQualificationOutcomeSchema),
  eligible: z.boolean(),
  alreadyClaimed: z.boolean(),
  remaining: z.number().nullable(),
  endsAt: z.string().nullable(),
});

export type LoyaltyOffer = z.infer<typeof loyaltyOfferSchema>;

// claimFriction is included so the claim screen never needs its own
// network round-trip before showing the use-plan picker — see
// hub-mobile-app-migration-plan.md's voucher-state route change.
export const voucherStateSchema = z.object({
  balance: z.number().nullable(),
  claimedFundedAllocationIds: z.array(z.string()),
  loyaltyOffers: z.array(loyaltyOfferSchema),
  claimFriction: claimFrictionSchema,
});

export type VoucherState = z.infer<typeof voucherStateSchema>;
