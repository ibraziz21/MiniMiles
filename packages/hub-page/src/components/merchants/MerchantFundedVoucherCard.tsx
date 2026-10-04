import { CalendarClock, Sparkles } from "lucide-react";
import { ClaimOfferButton } from "@/components/vouchers/ClaimOfferButton";
import type { FundedOffer } from "@/components/vouchers/FundedOfferCard";

export function MerchantFundedVoucherCard({
  offer,
  isSignedIn,
  alreadyClaimed,
}: {
  offer: FundedOffer;
  isSignedIn: boolean;
  alreadyClaimed: boolean;
}) {
  const claimEnds = new Date(offer.claimEndsAt);
  const claimEndsLabel = Number.isFinite(claimEnds.getTime())
    ? claimEnds.toLocaleDateString("en-KE", { day: "numeric", month: "short" })
    : null;

  return (
    <article className="flex h-full flex-col rounded-2xl border border-emerald-200 bg-white p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
          <Sparkles className="h-4 w-4" aria-hidden="true" /> Akiba-funded
        </span>
        <div className="shrink-0 text-right">
          <p className="font-sterling text-lg font-semibold leading-none text-akiba-ink">Free</p>
          <p className="mt-1 text-[11px] text-akiba-muted">No Miles needed</p>
        </div>
      </div>

      <p className="mt-5 font-sterling text-2xl font-semibold leading-none text-akiba-ink">
        KES {offer.discountKes.toLocaleString("en-KE")} off
      </p>
      <h3 className="mt-2 text-sm font-semibold leading-snug text-akiba-ink">{offer.title}</h3>
      <p className="mt-1 text-xs leading-5 text-akiba-muted">
        Spend at least KES {offer.minimumSpendKes.toLocaleString("en-KE")}
      </p>
      {offer.eligibilitySummary && (
        <p className="mt-3 border-l-2 border-emerald-300 pl-3 text-xs leading-5 text-akiba-muted">
          {offer.eligibilitySummary}
        </p>
      )}
      {claimEndsLabel && (
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-akiba-muted">
          <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Claim by {claimEndsLabel}
        </p>
      )}

      <div className="mt-auto pt-5">
        <ClaimOfferButton
          allocationId={offer.allocationId}
          isSignedIn={isSignedIn}
          alreadyClaimed={alreadyClaimed}
          eligibilitySummary={offer.eligibilitySummary}
          merchantName={offer.merchant.name}
          claimEndsAt={offer.claimEndsAt}
        />
      </div>
    </article>
  );
}
