import { z } from 'zod';

// Source: /api/v1/me/welcome-offer (hub-page src/lib/akiba/welcomeOffer.ts,
// docs/BDR-008). `awarded` means the voucher is already issued — the app
// shows the offer only then, never on a promise.
export const welcomeOfferSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('none') }),
  // Reason is a string, not an enum: a server adding a reason must not make
  // an older build fail to parse a response it would ignore anyway.
  z.object({ state: z.literal('unavailable'), reason: z.string() }),
  z.object({
    state: z.enum(['awarded', 'redeemed', 'expired']),
    voucherId: z.string(),
    discountPercent: z.number(),
    maximumDiscountKes: z.number(),
    minimumSpendKes: z.number(),
    expiresAt: z.string(),
  }),
]);

export const welcomeOfferResponseSchema = z.object({ welcomeOffer: welcomeOfferSchema });

export type WelcomeOffer = z.infer<typeof welcomeOfferSchema>;
export type AwardedWelcomeOffer = Extract<WelcomeOffer, { voucherId: string }> & { state: 'awarded' };
