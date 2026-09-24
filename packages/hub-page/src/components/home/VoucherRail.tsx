import Link from "next/link";
import { ArrowRight, ChevronRight, ShoppingBag } from "lucide-react";
import { EarnIcon, MilesAmount } from "@/components/MilesIcon";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { SectionViewTracker } from "./SectionViewTracker";
import type { MerchantValueSummary } from "@/lib/home/types";

export function VoucherRail({ merchants }: { merchants: MerchantValueSummary[] }) {
  const seen = new Set<string>();
  const offers = merchants.filter((merchant) => {
    if (!merchant.topOffer || seen.has(merchant.topOffer.templateId)) return false;
    seen.add(merchant.topOffer.templateId);
    return true;
  });

  if (offers.length === 0) return null;

  return (
    <section className="mb-7 sm:mb-8" aria-label="Vouchers available now">
      <SectionViewTracker sectionId="vouchers" personalized={false} />
      <div className="mb-2.5 flex items-end justify-between gap-2 sm:mb-3 sm:gap-4">
        <div>
          <p className="mb-0.5 text-[11px] font-bold uppercase tracking-[0.15em] text-akiba-teal">Use your Miles</p>
          <h2 className="font-sterling text-xl font-semibold text-akiba-ink sm:text-2xl">Vouchers available now</h2>
        </div>
        <Link href="/vouchers?tab=available" className="-mb-1 -mr-2 flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-tint hover:text-akiba-tealDark active:bg-akiba-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal">
          See all <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {offers.map((merchant, index) => {
          const offer = merchant.topOffer!;
          return (
            <TrackedLink
              key={offer.templateId}
              href={`/merchants/${merchant.slug}`}
              event="home_voucher_tap"
              eventProps={{ merchant_id: merchant.id, template_id: offer.templateId, position: index }}
              className="group relative flex min-h-48 w-[calc(100vw-3rem)] max-w-[320px] shrink-0 snap-start flex-col overflow-hidden rounded-3xl border border-akiba-teal/20 bg-white p-4 transition hover:-translate-y-0.5 hover:border-akiba-teal/40 hover:shadow-soft active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal sm:w-72"
            >
              <div className="absolute -right-8 -top-10 h-28 w-28 rounded-full bg-akiba-tint" />
              <div className="relative flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-akiba-line bg-white shadow-chip">
                    {merchant.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={merchant.logoUrl} alt="" className="h-full w-full object-contain p-0.5" />
                    ) : (
                      <ShoppingBag className="h-5 w-5 text-akiba-muted" aria-hidden="true" />
                    )}
                  </div>
                  <span className="truncate text-xs font-medium text-akiba-muted">{merchant.name}</span>
                </div>
                <EarnIcon className="h-5 w-5 shrink-0" />
              </div>

              <div className="relative mt-5">
                <p className="font-sterling text-2xl font-bold leading-tight text-akiba-ink">{offer.label}</p>
                <p className="mt-1 text-xs text-akiba-muted">Voucher at {merchant.name}</p>
              </div>

              <div className="relative mt-auto flex items-end justify-between gap-3 pt-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-akiba-muted">Miles price</p>
                  <MilesAmount amount={offer.milesCost} size="sm" className="mt-0.5 text-akiba-ink" />
                </div>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-akiba-ink text-white transition group-hover:bg-akiba-teal">
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </span>
              </div>
            </TrackedLink>
          );
        })}
      </div>
    </section>
  );
}
