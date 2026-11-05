import type { FundedOffer } from '@/contracts/vouchers';

export type VoucherCampaign = {
  id: string;
  title: string;
  offers: FundedOffer[];
  quantityRemaining: number | null;
};

export function groupVoucherCampaigns(offers: readonly FundedOffer[]) {
  const byId = new Map<string, VoucherCampaign>();
  const standalone: FundedOffer[] = [];
  const seen = new Set<string>();

  for (const offer of offers) {
    if (seen.has(offer.allocationId)) continue;
    seen.add(offer.allocationId);
    if (!offer.campaign) {
      standalone.push(offer);
      continue;
    }
    const group = byId.get(offer.campaign.id) ?? {
      ...offer.campaign, offers: [], quantityRemaining: 0,
    };
    group.offers.push(offer);
    group.quantityRemaining = group.quantityRemaining === null || offer.quantityRemaining === undefined
      ? null
      : group.quantityRemaining + offer.quantityRemaining;
    byId.set(group.id, group);
  }
  return { campaigns: [...byId.values()], standalone };
}

export function campaignInventoryLabel(campaign: VoucherCampaign) {
  const count = campaign.quantityRemaining;
  if (count === 0) return 'All vouchers claimed';
  if (count !== null) return `${count.toLocaleString('en-KE')} ${count === 1 ? 'voucher' : 'vouchers'} left`;
  return `${campaign.offers.length} ${campaign.offers.length === 1 ? 'offer' : 'offers'}`;
}
