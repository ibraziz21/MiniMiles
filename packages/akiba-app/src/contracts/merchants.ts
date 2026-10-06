import { z } from 'zod';

// Source: hub-page's GET /api/v1/merchants (src/app/api/v1/merchants/route.ts),
// which maps hub-page's MerchantValueSummary (src/lib/home/types.ts) onto
// the wire. Shared with home.ts — home feed sections carry this exact card
// shape too.
const matchReasonSchema = z.object({
  kind: z.enum(['intent', 'distance', 'voucher', 'affordable', 'affinity', 'earn', 'availability', 'new']),
  label: z.string().optional(),
  distanceKm: z.number().optional(),
  templateId: z.string().optional(),
});

export const merchantValueSummarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  primaryCategory: z.object({ slug: z.string(), name: z.string() }).nullable(),
  matchedOffering: z.string().nullable(),
  operatingModel: z.enum(['physical', 'hybrid', 'online']),
  nearestLocation: z
    .object({
      id: z.string(),
      locality: z.string().nullable(),
      city: z.string(),
      distanceKm: z.number().nullable(),
      openStatus: z.enum(['open', 'closed', 'unknown']),
      closesAt: z.string().nullable(),
    })
    .nullable(),
  topOffer: z
    .object({
      templateId: z.string(),
      label: z.string(),
      milesCost: z.number(),
      affordable: z.boolean().nullable(),
      expiresAt: z.string().nullable(),
    })
    .nullable(),
  earnSummary: z.object({ label: z.string(), deterministic: z.boolean() }).nullable(),
  reasons: z.array(matchReasonSchema),
  voucherCount: z.number().optional(),
  branchCount: z.number().optional(),
});

export type MerchantValueSummary = z.infer<typeof merchantValueSummarySchema>;

export const merchantDirectoryResponseSchema = z.object({
  merchants: z.array(merchantValueSummarySchema),
  next_cursor: z.string().nullable(),
  applied: z.object({
    category: z.string().nullable(),
    city: z.string().nullable(),
    nearby: z.boolean(),
  }),
});

export type MerchantDirectoryResponse = z.infer<typeof merchantDirectoryResponseSchema>;

// Source: GET /api/v1/me/merchant-state (src/app/api/v1/me/merchant-state/route.ts).
export const merchantStateSchema = z.object({
  balance: z.number().nullable(),
  saved: z.array(z.string()),
});

export type MerchantState = z.infer<typeof merchantStateSchema>;

// Source: POST/DELETE /api/v1/merchants/:slug/save
// (src/app/api/v1/merchants/[slug]/save/route.ts).
export const saveMerchantResponseSchema = z.object({
  saved: z.boolean(),
});

export type SaveMerchantResponse = z.infer<typeof saveMerchantResponseSchema>;
