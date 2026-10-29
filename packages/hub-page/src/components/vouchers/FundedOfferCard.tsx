import { entitlementFromOffer, entitlementBenefit } from "@/lib/vouchers/customerEntitlement";
import { VoucherEntitlementSummary } from "./VoucherEntitlementSummary";
import { CheckCircle2, ShoppingBag } from "lucide-react";
import { ClaimOfferButton } from "@/components/vouchers/ClaimOfferButton";

export type FundedOffer = {
  allocationId: string;
  title: string;
  /**
   * `voucherType` decides which benefit fields are populated. A percentage
   * offer stores no flat amount at all (the authoring RPC writes
   * discount_kes = NULL deliberately, so there is never a stale second answer
   * to "what is this worth?"), so `discountKes` is null for those.
   */
  voucherType: "fixed_off" | "percent_off";
  discountKes: number | null;
  discountPercent: number | null;
  maximumDiscountKes: number | null;
  minimumSpendKes: number;
  terms: string | null;
  eligibilitySummary: string | null;
  claimEndsAt: string;
  voucherValiditySeconds?: number | null;
  claimStartsAt?: string;
  claimsOpen?: boolean;
  redemptionSchedule?: { days: number[]; timezone: string; startDate?: string; endDate?: string } | null;
  claimDays?: number[];
  merchant: { name: string; slug: string; imageUrl: string | null };
  /**
   * Every merchant this voucher may be redeemed at, primary first, then the
   * rest by name. Always populated — a single-merchant offer carries one
   * entry — so no consumer needs a special case, and multi-merchant status is
   * read from the authoritative set rather than inferred from how many
   * profiles happened to load (BDR-006).
   */
  merchants: MerchantSummary[];
};

export type MerchantSummary = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
};

/**
 * The participant list, tolerating a payload that predates the field.
 *
 * `merchants` is required on the type and every loader populates it, but a
 * serialized offer from an older deploy will not have it. Falling back to
 * `[merchant]` is the documented legacy behaviour: such an offer genuinely
 * was single-merchant, since nothing could produce a multi-merchant one
 * before this field existed. Reading `.length` off undefined instead would
 * take down a whole catalogue response.
 */
export function offerMerchants(offer: FundedOffer): MerchantSummary[] {
  if (Array.isArray(offer.merchants) && offer.merchants.length > 0) return offer.merchants;
  if (!offer.merchant) return [];
  return [{ id: "", name: offer.merchant.name, slug: offer.merchant.slug, imageUrl: offer.merchant.imageUrl }];
}

/** A voucher usable at more than one merchant. */
export function isMultiMerchantOffer(offer: FundedOffer): boolean {
  return offerMerchants(offer).length > 1;
}

/** Compatibility export for callers adopting the shared entitlement summary. */
export function FundedOfferParticipants({
  offer,
  className = "",
}: {
  offer: FundedOffer;
  className?: string;
}) {
  return <VoucherEntitlementSummary entitlement={entitlementFromOffer(offer)} />;
}

/** Where a funded offer can be spent, in words. */
export function fundedMerchantLabel(offer: FundedOffer): string {
  const merchants = offerMerchants(offer);
  if (merchants.length <= 1) return offer.merchant.name;
  return `Use once at any of ${merchants.length} merchants`;
}

/**
 * The one place a funded offer's benefit is turned into words. Shared by the
 * vouchers grid and the merchant page so a percentage offer cannot read as a
 * flat discount on one surface and not the other.
 */
export function fundedBenefitLabel(offer: FundedOffer): string {
  return entitlementBenefit(entitlementFromOffer(offer));
}

/**
 * Akiba-funded voucher offer — free, eligibility-gated, never Miles-priced
 * (akiba-funded-voucher-admin-spec.md §7.3 "must never infer voucher value
 * from a Miles price"). Visually distinct from the Miles catalog's
 * AvailableCard via its free-offer styling, but shares its
 * merchant-header layout for a consistent grid on the same page.
 */
export function FundedOfferCard({
  offer,
  isSignedIn,
  alreadyClaimed,
}: {
  offer: FundedOffer;
  isSignedIn: boolean;
  /** Computed server-side, straight from voucher_claims — see getClaimedAllocationIds. */
  alreadyClaimed: boolean;
}) {
  const entitlement = entitlementFromOffer(offer);

  return (
    <article id={`funded-${offer.allocationId}`} className={`group scroll-mt-24 flex min-h-[320px] flex-col overflow-hidden rounded-3xl border bg-white transition hover:-translate-y-0.5 hover:shadow-soft ${alreadyClaimed ? "border-akiba-line" : "border-emerald-200"}`}>
      <div className="relative border-b border-dashed border-emerald-200 bg-emerald-50 px-4 pb-5 pt-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-emerald-100 bg-white shadow-chip">
          {offer.merchant.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
                <img src={offer.merchant.imageUrl} alt={offer.merchant.name} className="h-full w-full object-contain p-0.5" />
          ) : (
            <ShoppingBag className="h-5 w-5 text-akiba-muted" />
          )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-akiba-muted">{offer.merchant.name}</p>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${alreadyClaimed ? "bg-akiba-card text-akiba-muted" : "bg-emerald-700 text-white"}`}>
            {alreadyClaimed ? "Claimed" : "Free"}
          </span>
        </div>
        <p className="mt-5 font-sterling text-2xl font-bold leading-none text-akiba-ink">
          {fundedBenefitLabel(offer)}
        </p>
      </div>

      <div className="flex flex-1 flex-col px-4 py-4 text-sm text-akiba-muted">
        <h3 className="font-semibold leading-snug text-akiba-ink">{offer.title}</h3>
        <div className="mt-2"><VoucherEntitlementSummary entitlement={entitlement} /></div>
        {offer.eligibilitySummary && <p className="mt-2 rounded-xl bg-akiba-card px-3 py-2 text-xs">{offer.eligibilitySummary}</p>}
        <div className="mt-auto pt-4">
          {alreadyClaimed && (
            <p className="mb-2 flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Added to My vouchers
            </p>
          )}
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
      </div>

      <a
        href={`/merchants/${offer.merchant.slug}`}
        className="flex min-h-11 items-center justify-center border-t border-akiba-line bg-akiba-card/70 py-2.5 text-xs font-semibold text-akiba-muted transition hover:bg-emerald-50 hover:text-emerald-700"
      >
        View merchant
      </a>
    </article>
  );
}
