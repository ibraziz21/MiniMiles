import { describe, expect, it } from 'vitest';

import { mobileHomeSchema } from '@/contracts';
import {
  getScreenshotMerchantOffers,
  getScreenshotOwnedVouchers,
  getScreenshotVoucherCatalogue,
  getScreenshotVoucherState,
  isScreenshotOfferId,
  withScreenshotHomeFixtures,
} from '@/fixtures/screenshot-commerce';

describe('screenshot commerce fixtures', () => {
  it('provides a populated, internally consistent screenshot catalogue', () => {
    const offers = getScreenshotMerchantOffers();
    const catalogue = getScreenshotVoucherCatalogue();
    const state = getScreenshotVoucherState();
    const owned = getScreenshotOwnedVouchers();

    expect(offers.offers.length).toBeGreaterThanOrEqual(4);
    expect(offers.offers.every((offer) => isScreenshotOfferId(offer.id))).toBe(true);
    expect(catalogue.templates.length).toBeGreaterThan(0);
    expect(catalogue.fundedOffers.length).toBeGreaterThan(0);
    expect(state.balance).toBeGreaterThan(0);
    expect(owned.vouchers.some((voucher) => voucher.status === 'issued')).toBe(true);
    expect(owned.vouchers.some((voucher) => voucher.status === 'redeemed')).toBe(true);
  });

  it('adds screenshot offers and balance to a valid home response', () => {
    const home = mobileHomeSchema.parse({
      feed: {
        rankingVersion: 'test',
        generatedAt: '2026-10-17T00:00:00.000Z',
        intents: [],
        sections: [],
        businessOffers: [],
        verifiedHighlights: [],
        rewards: null,
        nextReward: null,
      },
      cities: [],
      member: null,
    });

    const result = withScreenshotHomeFixtures(home);

    expect(result.feed.businessOffers).toEqual(getScreenshotMerchantOffers().offers);
    expect(result.feed.rewards?.milesBalance).toBe(getScreenshotVoucherState().balance);
  });
});
