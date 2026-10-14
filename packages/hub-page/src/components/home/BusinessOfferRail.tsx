import Link from "next/link";
import { ArrowRight, ChevronRight, Store } from "lucide-react";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { getMerchantOfferAvailability } from "@/lib/merchants/offerAvailability";
import type { PublicMerchantOfferFeedItem } from "@/lib/merchants/types";
import { SectionViewTracker } from "./SectionViewTracker";

export function BusinessOfferCard({ offer, position = 0, compact = false }: { offer: PublicMerchantOfferFeedItem; position?: number; compact?: boolean }) {
  const availability = getMerchantOfferAvailability(offer);

  return (
    <TrackedLink
      href={`/merchants/${offer.partner.slug}#offers`}
      event="home_business_offer_tap"
      eventProps={{ merchant_id: offer.partner.id, offer_id: offer.id, position }}
      className={`group flex h-full overflow-hidden rounded-2xl border border-akiba-line bg-white transition hover:border-akiba-teal/30 hover:shadow-chip active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal ${compact ? "min-h-[124px] flex-row" : "min-h-64 flex-col rounded-3xl hover:-translate-y-0.5"}`}
    >
      <div className={`relative overflow-hidden bg-akiba-tint ${compact ? "min-h-[124px] w-28 shrink-0 sm:w-36" : "min-h-36 flex-1"}`}>
        {offer.thumbnailUrl ? (
          // Merchant-authored offer art is decorative here; the card text names the offer.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={offer.thumbnailUrl} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]" />
        ) : (
          <div className={`flex h-full items-center justify-center ${compact ? "min-h-[124px]" : "min-h-36"}`}>
            {offer.partner.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={offer.partner.logoUrl} alt="" className="h-16 w-16 rounded-2xl bg-white object-contain p-1.5 shadow-chip" />
            ) : (
              <Store className="h-9 w-9 text-akiba-teal" aria-hidden="true" />
            )}
          </div>
        )}
        <span className={`absolute rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold text-akiba-ink shadow-chip ${compact ? "left-2 top-2" : "left-3 top-3"}`}>
          {availability.label}
        </span>
      </div>

      <div className={`min-w-0 ${compact ? "flex flex-1 flex-col justify-center p-3.5 sm:p-4" : "p-4"}`}>
        <p className="truncate text-xs font-medium text-akiba-muted">{offer.partner.name}</p>
        <div className="flex items-center gap-2">
          <h3 className={`mt-1 line-clamp-2 min-w-0 flex-1 font-sterling font-semibold leading-tight text-akiba-ink ${compact ? "text-lg" : "text-xl"}`}>{offer.title}</h3>
          {compact && <ChevronRight className="h-4 w-4 shrink-0 text-akiba-muted" aria-hidden="true" />}
        </div>
        <p className={`${compact ? "mt-2" : "mt-3"} text-[11px] font-semibold text-akiba-teal`}>No AkibaMiles required</p>
      </div>
    </TrackedLink>
  );
}

export function BusinessOfferRail({ offers }: { offers: PublicMerchantOfferFeedItem[] }) {
  if (offers.length === 0) return null;
  const single = offers.length === 1;

  return (
    <section className="mb-7 sm:mb-8" aria-label="Business offers">
      <SectionViewTracker sectionId="business_offers" personalized={false} />
      <div className="mb-2.5 flex min-h-11 items-end justify-between gap-3 sm:mb-3">
        <h2 className="font-sterling text-xl font-semibold text-akiba-ink sm:text-2xl">Business offers</h2>
        {!single && (
          <Link
            href="/offers"
            className="-mb-1 -mr-2 flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-tint active:bg-akiba-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            See all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      {single ? (
        <div className="max-w-2xl">
          <BusinessOfferCard offer={offers[0]} compact />
        </div>
      ) : (
        <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
          {offers.map((offer, index) => (
            <div key={offer.id} className="w-[calc(100vw-3rem)] max-w-[310px] shrink-0 snap-start">
              <BusinessOfferCard offer={offer} position={index} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
