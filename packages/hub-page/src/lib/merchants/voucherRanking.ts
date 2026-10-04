import type { PublicVoucherSummary } from "@/lib/merchants/types";

function expiryTime(value: string | null): number {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
}

/**
 * Merchant-profile ordering: offers within the member's current balance are
 * useful now, so they come first. Within each group, the lowest Miles price
 * is the clearest next action; expiry and title provide stable tie-breakers.
 */
export function rankMerchantVouchers(
  vouchers: PublicVoucherSummary[],
  balance: number | null,
): PublicVoucherSummary[] {
  return [...vouchers].sort((a, b) => {
    if (balance != null) {
      const aAffordable = a.milesCost <= balance;
      const bAffordable = b.milesCost <= balance;
      if (aAffordable !== bAffordable) return aAffordable ? -1 : 1;
    }
    if (a.milesCost !== b.milesCost) return a.milesCost - b.milesCost;
    const expiryDifference = expiryTime(a.expiresAt) - expiryTime(b.expiresAt);
    if (expiryDifference !== 0) return expiryDifference;
    return a.title.localeCompare(b.title);
  });
}

/** Keep immediately claimable funded offers ahead of already-claimed ones. */
export function rankMerchantFundedOffers<T extends { allocationId: string }>(
  offers: T[],
  claimedAllocationIds: Set<string>,
): T[] {
  return [...offers].sort(
    (a, b) => Number(claimedAllocationIds.has(a.allocationId)) - Number(claimedAllocationIds.has(b.allocationId)),
  );
}
