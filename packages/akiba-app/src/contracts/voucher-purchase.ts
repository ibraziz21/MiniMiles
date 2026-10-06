import { z } from 'zod';

// Source: hub-page's POST /api/v1/vouchers/{quote,redeem} and
// GET/POST /api/v1/vouchers/funded/:allocationId/{eligibility,claim}
// (src/app/api/v1/vouchers/**). claimFriction mirrors VoucherClaimFriction
// (src/lib/vouchers/claimIntent.ts) — the same intent-confirmation gate
// shared by every acquisition path on the backend.
export const voucherUsePlanSchema = z.enum(['nearby', 'planned_visit', 'upcoming_trip', 'other']);

export type VoucherUsePlan = z.infer<typeof voucherUsePlanSchema>;

export const claimFrictionSchema = z.object({
  expiredUnusedCount: z.number(),
  activeUnusedCount: z.number(),
  redeemedCount: z.number(),
  requiresUsePlan: z.boolean(),
});

export type ClaimFriction = z.infer<typeof claimFrictionSchema>;

export const voucherQuoteSchema = z.object({
  quoteId: z.string(),
  ledgerPoints: z.number(),
  onchainPoints: z.number(),
  totalPoints: z.number(),
  disclosureVersion: z.string(),
  walletAddress: z.string().nullable(),
  claimFriction: claimFrictionSchema,
});

export type VoucherQuote = z.infer<typeof voucherQuoteSchema>;

export const voucherRedemptionSchema = z.object({
  voucher: z.object({ id: z.string(), code: z.string(), status: z.string() }),
  queued: z.boolean(),
  intentState: z.string(),
});

export type VoucherRedemption = z.infer<typeof voucherRedemptionSchema>;

export const fundedEligibilitySchema = z.object({
  eligible: z.boolean(),
  alreadyClaimed: z.boolean(),
  requirementsRemaining: z.array(z.string()),
  allocationAvailable: z.boolean(),
  claimFriction: claimFrictionSchema,
});

export type FundedEligibility = z.infer<typeof fundedEligibilitySchema>;

export const fundedClaimResultSchema = z.object({
  voucherId: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  idempotent: z.boolean(),
});

export type FundedClaimResult = z.infer<typeof fundedClaimResultSchema>;

// Source: POST /api/v1/vouchers/loyalty/:templateId/claim
// (src/app/api/v1/vouchers/loyalty/[templateId]/claim/route.ts) — a
// different success shape than fundedClaimResultSchema (carries milesSpent,
// not a voucher code/status pair), so it gets its own schema rather than
// reusing one that happens to look similar.
export const loyaltyClaimResultSchema = z.object({
  voucherId: z.string(),
  status: z.string(),
  expiresAt: z.string(),
  milesSpent: z.number(),
  idempotent: z.boolean(),
});

export type LoyaltyClaimResult = z.infer<typeof loyaltyClaimResultSchema>;
