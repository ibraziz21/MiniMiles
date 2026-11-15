import { describe, expect, it } from 'vitest';

import { welcomeOfferResponseSchema } from '@/contracts/welcome-offer';

describe('welcome offer contract', () => {
  it('reads an issued offer', () => {
    const parsed = welcomeOfferResponseSchema.parse({
      welcomeOffer: {
        state: 'awarded',
        voucherId: '0b6a1c2e-5f3d-4c1a-9e8b-7d6c5b4a3f21',
        discountPercent: 25,
        maximumDiscountKes: 250,
        minimumSpendKes: 1000,
        expiresAt: '2026-11-17T09:00:00.000Z',
      },
    });
    expect(parsed.welcomeOffer).toMatchObject({ state: 'awarded', discountPercent: 25 });
  });

  it('accepts a reason this build has never seen, so a newer server never breaks onboarding', () => {
    expect(
      welcomeOfferResponseSchema.parse({ welcomeOffer: { state: 'unavailable', reason: 'brand_new_reason' } }).welcomeOffer,
    ).toEqual({ state: 'unavailable', reason: 'brand_new_reason' });
  });

  it('rejects an award missing its figures rather than showing an empty ticket', () => {
    expect(() =>
      welcomeOfferResponseSchema.parse({ welcomeOffer: { state: 'awarded', voucherId: 'v' } }),
    ).toThrow();
  });
});
