import { ArrowUpRight, Ticket } from "lucide-react";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { fundedBenefitLabel, type FundedOffer } from "@/components/vouchers/FundedOfferCard";

/** A discovery entry point; eligibility is checked on the voucher claim page. */
export function FundedVoucherSection({ offers }: { offers: FundedOffer[] }) {
  if (offers.length === 0) return null;

  return (
    <section aria-labelledby="funded-voucher-heading" className="mb-7 sm:mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="funded-voucher-heading" className="font-sterling text-xl font-semibold text-akiba-ink sm:text-2xl">A little extra for your next visit</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {offers.slice(0, 4).map((offer) => (
          <TrackedLink
            key={offer.allocationId}
            href={`/vouchers?tab=claimable#funded-${offer.allocationId}`}
            event="home_funded_voucher_tap"
            eventProps={{ allocation_id: offer.allocationId, merchant_slug: offer.merchant.slug }}
            className="group flex min-w-0 flex-col rounded-3xl border border-akiba-teal/20 bg-akiba-tint p-5 text-akiba-ink transition hover:border-akiba-teal/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2 sm:p-6"
          >
            <div className="mb-5 flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-medium text-akiba-muted"><Ticket className="h-4 w-4" aria-hidden="true" />On Akiba. No Miles needed.</span>
              {offer.merchant.imageUrl && (
                // The merchant is named in the card heading.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={offer.merchant.imageUrl} alt="" width={40} height={40} className="h-10 w-10 rounded-xl bg-white object-contain p-1" />
              )}
            </div>
            <h3 className="font-sterling text-2xl font-semibold leading-tight">Going to {offer.merchant.name}{offer.redemptionSchedule?.days.length === 2 && offer.redemptionSchedule.days.includes(0) && offer.redemptionSchedule.days.includes(6) ? " this weekend" : ""}?</h3>
            <p className="mt-2 text-lg font-semibold text-akiba-tealDark">{fundedBenefitLabel(offer)} on your bill</p>
            <p className="mt-2 text-xs leading-relaxed text-akiba-muted">Minimum bill KES {offer.minimumSpendKes.toLocaleString("en-KE")}. {offer.eligibilitySummary ?? "Eligibility requirements apply."}</p>
            <span className="mt-5 flex min-h-11 items-center justify-between rounded-xl bg-akiba-tealDark px-4 py-3 text-sm font-semibold text-white">{offer.claimsOpen === false && offer.claimStartsAt ? `View offer · claims open ${new Date(offer.claimStartsAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", timeZone: "Africa/Nairobi" })}` : "Claim now"} <ArrowUpRight className="h-5 w-5" aria-hidden="true" /></span>
          </TrackedLink>
        ))}
      </div>
    </section>
  );
}
