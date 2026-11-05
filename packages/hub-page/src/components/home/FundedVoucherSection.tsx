import { BadgeCheck, Store, Ticket } from "lucide-react";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { ClaimOfferButton } from "@/components/vouchers/ClaimOfferButton";
import { fundedBenefitLabel, fundedMerchantLabel, isMultiMerchantOffer, type FundedOffer } from "@/components/vouchers/FundedOfferCard";
import { entitlementFromOffer } from "@/lib/vouchers/customerEntitlement";

export function FundedVoucherSection({
  offers,
  isSignedIn,
  claimedIds = new Set<string>(),
}: {
  offers: FundedOffer[];
  isSignedIn: boolean;
  claimedIds?: Set<string>;
}) {
  const claimable = offers.filter((offer) => offer.claimsOpen !== false && !claimedIds.has(offer.allocationId));
  if (claimable.length === 0) return null;

  return (
    <section aria-labelledby="funded-voucher-heading" className="mb-6">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 id="funded-voucher-heading" className="font-sterling text-xl font-semibold text-akiba-ink">Claimable offers</h2>
        <TrackedLink href="/vouchers?tab=claimable" event="home_funded_vouchers_see_all" className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-sm font-semibold text-akiba-tealAccessible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal">
          See all
        </TrackedLink>
      </div>
      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-px-4 px-4 pb-2 sm:mx-0 sm:px-0">
        {claimable.slice(0, 4).map((offer) => {
          const multi = isMultiMerchantOffer(offer);
          const identity = fundedMerchantLabel(offer);
          const TileIcon = multi ? Ticket : Store;
          const claimEnd = new Date(offer.claimEndsAt);
          const conditions = [
            offer.minimumSpendKes > 0 ? `Min. spend KES ${offer.minimumSpendKes.toLocaleString("en-KE")}` : null,
            Number.isFinite(claimEnd.getTime()) ? `Claim by ${claimEnd.toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" })}` : null,
          ].filter(Boolean).join(" · ");
          return (
            <article key={offer.allocationId} className="flex w-[min(84vw,320px)] shrink-0 snap-start flex-col gap-3 rounded-2xl border border-akiba-line bg-white p-3.5">
              <div className="flex items-start gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl bg-akiba-tint">
                  {!multi && offer.merchant.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={offer.merchant.imageUrl} alt="" width={56} height={56} className="h-full w-full object-cover" />
                  ) : <TileIcon aria-hidden="true" className="h-7 w-7 text-akiba-tealAccessible" />}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="inline-flex items-center gap-1 rounded-full bg-akiba-tint px-2 py-1 text-[11px] font-semibold leading-none text-akiba-tealAccessible">
                    <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0" /> No AkibaMiles needed
                  </span>
                  <p className="mt-1.5 text-sm font-medium leading-snug text-akiba-muted">{identity}</p>
                </div>
              </div>
              <div>
                <h3 className="text-base font-bold leading-snug text-akiba-ink">{fundedBenefitLabel(offer)}</h3>
                {conditions && <p className="mt-1 text-xs text-akiba-muted">{conditions}</p>}
              </div>
              <div className="mt-auto flex justify-end">
                <ClaimOfferButton
                  compact
                  allocationId={offer.allocationId}
                  isSignedIn={isSignedIn}
                  alreadyClaimed={false}
                  merchantName={identity}
                  eligibilitySummary={offer.eligibilitySummary}
                  entitlement={entitlementFromOffer(offer)}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
