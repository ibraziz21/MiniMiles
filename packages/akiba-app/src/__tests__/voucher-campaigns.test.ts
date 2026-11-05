import { describe, expect, it } from 'vitest';

import { fundedOfferSchema } from '@/contracts/vouchers';
import { campaignInventoryLabel, groupVoucherCampaigns } from '@/lib/voucher-campaigns';

function offer(allocationId: string, campaignId?: string, quantityRemaining?: number) {
  return fundedOfferSchema.parse({
    allocationId, quantityRemaining, title: '10% off', minimumSpendKes: 500,
    terms: null, eligibilitySummary: null, claimEndsAt: '2099-01-01',
    merchant: { name: allocationId, slug: allocationId, imageUrl: null },
    ...(campaignId ? { campaign: { id: campaignId, title: 'Flea Market' } } : {}),
  });
}

describe('voucher campaigns', () => {
  it('adds inventory across unique offers and keeps funds with the same title separate', () => {
    const shared = offer('a', 'market-a', 2);
    const { campaigns, standalone } = groupVoucherCampaigns([
      shared, offer('b', 'market-a', 4), shared, offer('c', 'market-b', 0), offer('ordinary'),
    ]);
    expect(campaigns.map(campaignInventoryLabel)).toEqual(['6 vouchers left', 'All vouchers claimed']);
    expect(campaigns[0].offers.map((item) => item.allocationId)).toEqual(['a', 'b']);
    expect(standalone.map((item) => item.allocationId)).toEqual(['ordinary']);
  });

  it('uses the offer count when any inventory count is unavailable', () => {
    const { campaigns } = groupVoucherCampaigns([offer('a', 'market', 2), offer('b', 'market')]);
    expect(campaignInventoryLabel(campaigns[0])).toBe('2 offers');
  });
});
