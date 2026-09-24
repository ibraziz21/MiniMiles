import { BadgeCheck, CalendarClock, CheckCircle2, Lock, ShoppingBag } from "lucide-react";
import { MilesAmount } from "@/components/MilesIcon";
import { ClaimLoyaltyVoucherButton } from "@/components/vouchers/ClaimLoyaltyVoucherButton";

export type LoyaltyQualificationOutcome = {
  type: "merchant_purchase_count" | "merchant_net_spend_kes";
  minimum: number;
  actual: number | null;
  satisfied: boolean;
};

export type LoyaltyOffer = {
  templateId: string;
  title: string;
  description: string | null;
  voucherType: "free" | "percent_off" | "fixed_off" | "bogo";
  discountPercent: number | null;
  discountKes: number | null;
  retailValueKes: number | null;
  minimumSpendKes: number | null;
  maximumDiscountKes: number | null;
  merchant: { id: string; name: string; slug: string; imageUrl: string | null };
  accessPolicy: "public" | "loyalty_qualified";
  acquisitionMode: "miles" | "free";
  milesCost: number;
  qualificationMode: "any" | "all" | null;
  customerCopy: string | null;
  progress: LoyaltyQualificationOutcome[];
  eligible: boolean;
  alreadyClaimed: boolean;
  remaining: number | null;
  endsAt: string | null;
};

function benefitLabel(offer: LoyaltyOffer): string {
  if (offer.voucherType === "percent_off") {
    return `${offer.discountPercent ?? 0}% off${offer.maximumDiscountKes ? `, up to KES ${offer.maximumDiscountKes.toLocaleString("en-KE")}` : ""}`;
  }
  if (offer.voucherType === "fixed_off") return `KES ${(offer.discountKes ?? 0).toLocaleString("en-KE")} off`;
  if (offer.voucherType === "bogo") {
    return offer.retailValueKes
      ? `Buy one, get one · worth KES ${offer.retailValueKes.toLocaleString("en-KE")}`
      : "Buy one, get one";
  }
  return offer.retailValueKes
    ? `Free item · worth KES ${offer.retailValueKes.toLocaleString("en-KE")}`
    : "Free item";
}

function progressLabel(outcome: LoyaltyQualificationOutcome): string {
  if (outcome.type === "merchant_purchase_count") {
    return `${outcome.actual ?? 0} of ${outcome.minimum} purchases`;
  }
  return `KES ${(outcome.actual ?? 0).toLocaleString("en-KE")} of ${outcome.minimum.toLocaleString("en-KE")} spent`;
}

/**
 * A qualifying-customer progress bar shaped like RewardProgressBar
 * (components/akiba/RewardProgressBar.tsx) but generic over "actual of
 * minimum" rather than hardcoded to a Miles balance — a locked loyalty
 * voucher's requirement isn't a Miles amount.
 */
function QualificationProgressBar({ outcome }: { outcome: LoyaltyQualificationOutcome }) {
  const actual = Math.max(outcome.actual ?? 0, 0);
  const percent = outcome.minimum > 0
    ? Math.min(100, Math.max(0, Math.floor((actual / outcome.minimum) * 100)))
    : 100;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={outcome.minimum}
      aria-valuenow={Math.min(actual, outcome.minimum)}
      aria-valuetext={`${progressLabel(outcome)}. ${outcome.satisfied ? "Complete." : `${percent} percent complete.`}`}
      className="h-1.5 w-full overflow-hidden rounded-full bg-akiba-line"
    >
      <div
        className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500 ${outcome.satisfied ? "bg-emerald-500" : "bg-akiba-teal"}`}
        style={{ width: `${outcome.satisfied ? 100 : percent}%` }}
      />
    </div>
  );
}

/**
 * Loyalty-qualified-vouchers-spec.md §12.2/§15 offer card — a third,
 * independent implementation alongside AvailableCard (Miles catalogue) and
 * FundedOfferCard (Akiba-funded), matching this page's existing pattern of
 * one card+button pair per offer type rather than a shared abstraction.
 * Renders in both the "Claim free offers" and "Shop with Miles" grids
 * depending on acquisitionMode — see VoucherTabs.tsx.
 */
export function LoyaltyVoucherCard({
  offer,
  isSignedIn,
}: {
  offer: LoyaltyOffer;
  isSignedIn: boolean;
}) {
  const locked = offer.accessPolicy === "loyalty_qualified" && !offer.eligible && !offer.alreadyClaimed;
  const endsAt = offer.endsAt ? new Date(offer.endsAt) : null;
  const endsLabel = endsAt && Number.isFinite(endsAt.getTime())
    ? endsAt.toLocaleDateString("en-KE", { day: "numeric", month: "short" })
    : null;

  return (
    <article className={`group flex min-h-[320px] flex-col overflow-hidden rounded-3xl border bg-white transition hover:-translate-y-0.5 hover:shadow-soft focus-within:border-akiba-teal/40 ${offer.alreadyClaimed || locked ? "border-akiba-line" : "border-akiba-teal/20"} ${offer.alreadyClaimed ? "opacity-75" : ""}`}>
      <div className={`relative border-b border-dashed px-4 pb-5 pt-4 ${locked ? "border-akiba-line bg-akiba-card/60" : "border-akiba-teal/20 bg-gradient-to-br from-akiba-tint to-white"}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-akiba-line bg-white shadow-chip">
              {offer.merchant.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={offer.merchant.imageUrl} alt={offer.merchant.name} className="h-full w-full object-contain p-0.5" />
              ) : (
                <ShoppingBag className="h-5 w-5 text-akiba-muted" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-akiba-muted">{offer.merchant.name}</p>
              <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-akiba-teal">
                {locked ? <Lock className="h-3 w-3" aria-hidden="true" /> : <BadgeCheck className="h-3 w-3" aria-hidden="true" />}
                {offer.accessPolicy === "loyalty_qualified" ? "Loyalty reward" : "Reward"}
              </span>
            </div>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${offer.alreadyClaimed || locked ? "bg-akiba-card text-akiba-muted" : offer.acquisitionMode === "free" ? "bg-akiba-teal text-white" : "bg-akiba-ink text-white"}`}>
            {offer.alreadyClaimed ? "Claimed" : locked ? "Locked" : offer.acquisitionMode === "free" ? "Free" : "Available"}
          </span>
        </div>
        <p className="mt-5 font-sterling text-2xl font-bold leading-none text-akiba-ink">{benefitLabel(offer)}</p>
      </div>

      <div className="flex flex-1 flex-col px-4 py-4 text-sm text-akiba-muted">
        <h3 className="font-semibold leading-snug text-akiba-ink">{offer.title}</h3>
        {offer.minimumSpendKes != null && offer.minimumSpendKes > 0 && (
          <p className="mt-1.5 text-xs">
            Minimum purchase <span className="font-semibold text-akiba-ink">KES {offer.minimumSpendKes.toLocaleString("en-KE")}</span>
          </p>
        )}

        {locked && offer.customerCopy && (
          <div className="mt-3 space-y-2.5 rounded-xl bg-akiba-card px-3 py-3">
            <p className="text-xs text-akiba-ink">{offer.customerCopy}</p>
            {offer.progress.map((outcome) => (
              <div key={outcome.type} className="space-y-1">
                <p className="text-[11px] text-akiba-muted">{progressLabel(outcome)}</p>
                <QualificationProgressBar outcome={outcome} />
              </div>
            ))}
            <p className="text-[10px] text-akiba-muted/75">Progress is based on purchases recorded with Akiba.</p>
          </div>
        )}

        {endsLabel && (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-akiba-muted/80">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Claim by {endsLabel}
          </p>
        )}

        <div className="mt-auto pt-4">
          {offer.alreadyClaimed && (
            <p className="mb-2 flex items-center justify-center gap-1.5 text-xs font-medium text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" /> Added to My vouchers
            </p>
          )}
          {!offer.alreadyClaimed && offer.acquisitionMode === "miles" && (
            <div className="mb-2.5 flex items-center justify-between text-xs text-akiba-muted">
              <span>Miles price</span>
              <MilesAmount amount={offer.milesCost} size="sm" className="text-akiba-ink" />
            </div>
          )}
          <ClaimLoyaltyVoucherButton
            templateId={offer.templateId}
            isSignedIn={isSignedIn}
            alreadyClaimed={offer.alreadyClaimed}
            locked={locked}
            customerCopy={offer.customerCopy}
            merchantName={offer.merchant.name}
            endsAt={offer.endsAt}
            acquisitionMode={offer.acquisitionMode}
            milesCost={offer.milesCost}
          />
        </div>
      </div>

      <a
        href={`/merchants/${offer.merchant.slug}`}
        className="flex min-h-11 items-center justify-center border-t border-akiba-line bg-akiba-card/70 px-4 py-2.5 text-xs font-semibold text-akiba-muted transition hover:bg-akiba-tint hover:text-akiba-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-akiba-teal"
      >
        View merchant
      </a>
    </article>
  );
}
