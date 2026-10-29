import { entitlementFromOffer } from "@/lib/vouchers/customerEntitlement";
import { VoucherEntitlementSummary } from "@/components/vouchers/VoucherEntitlementSummary";
import { ClaimOfferButton } from "@/components/vouchers/ClaimOfferButton";
import {
  fundedBenefitLabel,
  type FundedOffer,
} from "@/components/vouchers/FundedOfferCard";

export function MerchantFundedVoucherCard({
  offer,
  isSignedIn,
  alreadyClaimed,
}: {
  offer: FundedOffer;
  isSignedIn: boolean;
  alreadyClaimed: boolean;
}) {
  const entitlement = entitlementFromOffer(offer);

  return (
    <article className="flex h-full flex-col rounded-2xl border border-emerald-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-end gap-4">
        <div className="shrink-0 text-right">
          <p className="font-sterling text-lg font-semibold leading-none text-akiba-ink">Free</p>
          <p className="mt-1 text-[11px] text-akiba-muted">No Miles needed</p>
        </div>
      </div>

      <p className="mt-5 font-sterling text-2xl font-semibold leading-none text-akiba-ink">
        {fundedBenefitLabel(offer)}
      </p>
      <h3 className="mt-2 text-sm font-semibold leading-snug text-akiba-ink">{offer.title}</h3>
      <div className="mt-3"><VoucherEntitlementSummary entitlement={entitlement} /></div>
      {offer.eligibilitySummary && <p className="mt-3 text-xs leading-5 text-akiba-muted">{offer.eligibilitySummary}</p>}

      <div className="mt-auto pt-5">
        <ClaimOfferButton
          allocationId={offer.allocationId}
          isSignedIn={isSignedIn}
          alreadyClaimed={alreadyClaimed}
          eligibilitySummary={offer.eligibilitySummary}
          entitlement={entitlement}
          claimStartsAt={offer.claimStartsAt}
          claimsOpen={offer.claimsOpen}
        />
      </div>
    </article>
  );
}
