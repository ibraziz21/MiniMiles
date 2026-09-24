import { CalendarClock, CheckCircle2, ShoppingBag, Sparkles } from "lucide-react";
import { ClaimOfferButton } from "@/components/vouchers/ClaimOfferButton";

export type FundedOffer = {
  allocationId: string;
  title: string;
  discountKes: number;
  minimumSpendKes: number;
  terms: string | null;
  eligibilitySummary: string | null;
  claimEndsAt: string;
  merchant: { name: string; slug: string; imageUrl: string | null };
};

/**
 * Akiba-funded voucher offer — free, eligibility-gated, never Miles-priced
 * (akiba-funded-voucher-admin-spec.md §7.3 "must never infer voucher value
 * from a Miles price"). Visually distinct from the Miles catalog's
 * AvailableCard via the "Funded by Akiba" badge (§12.1), but shares its
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
  const claimEnds = new Date(offer.claimEndsAt);
  const claimEndsLabel = Number.isFinite(claimEnds.getTime())
    ? claimEnds.toLocaleDateString("en-KE", { day: "numeric", month: "short" })
    : null;

  return (
    <article className={`group flex min-h-[320px] flex-col overflow-hidden rounded-3xl border bg-white transition hover:-translate-y-0.5 hover:shadow-soft ${alreadyClaimed ? "border-akiba-line opacity-75" : "border-emerald-200"}`}>
      <div className="relative border-b border-dashed border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-4 pb-5 pt-4">
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
              <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                <Sparkles className="h-3 w-3" aria-hidden="true" /> Funded by Akiba
              </span>
            </div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${alreadyClaimed ? "bg-akiba-card text-akiba-muted" : "bg-emerald-600 text-white"}`}>
            {alreadyClaimed ? "Claimed" : "Free"}
          </span>
        </div>
        <p className="mt-5 font-sterling text-2xl font-bold leading-none text-akiba-ink">
          KES {offer.discountKes.toLocaleString("en-KE")} off
        </p>
      </div>

      <div className="flex flex-1 flex-col px-4 py-4 text-sm text-akiba-muted">
        <h3 className="font-semibold leading-snug text-akiba-ink">{offer.title}</h3>
        <p className="mt-1.5 text-xs">
          Minimum purchase <span className="font-semibold text-akiba-ink">KES {offer.minimumSpendKes.toLocaleString("en-KE")}</span>
        </p>
        {offer.eligibilitySummary && <p className="mt-2 rounded-xl bg-akiba-card px-3 py-2 text-xs">{offer.eligibilitySummary}</p>}
        {claimEndsLabel && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-akiba-muted/80">
            <CalendarClock className="h-3.5 w-3.5" /> Claim by {claimEndsLabel}
          </p>
        )}
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
            merchantName={offer.merchant.name}
            claimEndsAt={offer.claimEndsAt}
          />
        </div>
      </div>

      <a
        href={`/merchants/${offer.merchant.slug}`}
        className="flex items-center justify-center border-t border-akiba-line bg-akiba-card/70 py-2.5 text-xs font-semibold text-akiba-muted transition hover:bg-emerald-50 hover:text-emerald-700"
      >
        View merchant
      </a>
    </article>
  );
}
