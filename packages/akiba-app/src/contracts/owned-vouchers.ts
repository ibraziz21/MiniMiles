import { z } from 'zod';

// Source: GET /api/v1/me/vouchers (src/app/api/v1/me/vouchers/route.ts) and
// GET /api/v1/me/vouchers/:id (src/app/api/v1/me/vouchers/[id]/route.ts).
// Both re-read directly — the two routes' nullability isn't identical
// (the list DTO comes from listOwnedVouchers; the detail route falls back
// to null per-field whenever the template join is missing), so they're
// modeled as two separate schemas rather than one shared shape.
export const ownedVoucherSummarySchema = z.object({
  id: z.string(),
  status: z.string(),
  title: z.string(),
  voucherType: z.string(),
  milesCost: z.number(),
  discountPercent: z.number().nullable(),
  discountCusd: z.number().nullable(),
  retailValueCusd: z.number().nullable(),
  merchantName: z.string().nullable(),
  merchantSlug: z.string().nullable(),
  merchantLogoUrl: z.string().nullable(),
  programName: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  redeemedAt: z.string().nullable(),
});

export type OwnedVoucherSummary = z.infer<typeof ownedVoucherSummarySchema>;

export const ownedVouchersListSchema = z.object({
  vouchers: z.array(ownedVoucherSummarySchema),
  next_cursor: z.string().nullable(),
});

export type OwnedVouchersList = z.infer<typeof ownedVouchersListSchema>;


const entitlementMerchantSchema = z.object({ id: z.string(), name: z.string(), slug: z.string(), imageUrl: z.string().nullable() });
export const voucherEntitlementSchema = z.object({
  title: z.string(), voucherType: z.string(), discountPercent: z.number().nullable(),
  discountKes: z.number().nullable(), discountCusd: z.number().nullable(),
  retailValueKes: z.number().nullable(), retailValueCusd: z.number().nullable(),
  maximumDiscountKes: z.number().nullable(), minimumSpendKes: z.number().nullable(),
  terms: z.string().nullable(), applicableCategory: z.string().nullable(), linkedProductId: z.string().nullable(),
  redemptionSchedule: z.object({ days: z.array(z.number()), timezone: z.string(), startDate: z.string().optional(), endDate: z.string().optional() }).nullable(),
  merchants: z.array(entitlementMerchantSchema), merchantCount: z.number(), merchantsIncomplete: z.boolean(),
  timing: z.object({ kind: z.literal('issued'), expiresAt: z.string().nullable() }),
});
export type VoucherEntitlement = z.infer<typeof voucherEntitlementSchema>;
export const voucherPresentationSchema = z.object({
  token: z.string().min(1), expires_at: z.string().datetime(), entitlement: voucherEntitlementSchema,
});
export type VoucherPresentation = z.infer<typeof voucherPresentationSchema>;
export const voucherPresentationStatusSchema = z.object({ voucher_status: z.string() });

export const voucherDetailSchema = z.object({
  entitlement: voucherEntitlementSchema.optional(),
  redemptionSchedule: z.object({ days: z.array(z.number().int().min(0).max(6)), timezone: z.string() }).nullable().optional(),
  id: z.string(),
  status: z.string(),
  title: z.string().nullable(),
  voucherType: z.string().nullable(),
  discountPercent: z.number().nullable(),
  discountCusd: z.number().nullable(),
  applicableCategory: z.string().nullable(),
  retailValueCusd: z.number().nullable(),
  milesCost: z.number().nullable(),
  merchantName: z.string().nullable(),
  merchantSlug: z.string().nullable(),
  merchantLogoUrl: z.string().nullable(),
  programName: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  redeemedAt: z.string().nullable(),
});

export type VoucherDetail = z.infer<typeof voucherDetailSchema>;
