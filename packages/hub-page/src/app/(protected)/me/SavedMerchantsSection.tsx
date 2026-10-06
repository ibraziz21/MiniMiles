import Link from "next/link";
import { ArrowRight, Bookmark } from "lucide-react";
import type { SavedMerchantSummary } from "@/lib/merchants/savedMerchants";

/**
 * Read-only list — unsaving happens from the merchant profile's own
 * SaveMerchantButton, not duplicated here (discovery-blueprint.md §6/§8).
 */
export function SavedMerchantsSection({
  merchants,
  showEmpty = false,
  expanded = false,
}: {
  merchants: SavedMerchantSummary[];
  showEmpty?: boolean;
  expanded?: boolean;
}) {
  if (merchants.length === 0 && !showEmpty) return null;

  const visible = expanded ? merchants : merchants.slice(0, 4);

  return (
    <section className="mb-7" aria-labelledby="saved-places-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="saved-places-heading" className="font-sterling text-xl font-semibold text-akiba-ink sm:text-2xl">
            Saved places
          </h2>
          <p className="mt-0.5 text-xs text-akiba-muted sm:text-sm">Places you want to come back to.</p>
        </div>
        {!expanded && merchants.length > 4 && (
          <Link
            href="/me/saved"
            className="-mb-1 -mr-2 flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-tint hover:text-akiba-tealDark active:bg-akiba-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            See all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-akiba-line bg-white px-6 py-8 text-center">
          <Bookmark className="mx-auto h-7 w-7 text-akiba-line" aria-hidden="true" />
          <p className="mt-3 text-sm font-medium text-akiba-ink">No saved places yet</p>
          <p className="mt-1 text-xs text-akiba-muted">Save merchants you want to visit or remember.</p>
          <Link
            href="/merchants"
            className="mt-4 inline-flex min-h-11 items-center rounded-full bg-akiba-ink px-4 text-xs font-semibold text-white transition hover:bg-akiba-teal active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            Explore merchants
          </Link>
        </div>
      ) : (
        <div className={expanded ? "grid grid-cols-2 gap-3 sm:grid-cols-3" : "no-scrollbar -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0"}>
          {visible.map((merchant) => (
            <Link
              key={merchant.id}
              href={`/merchants/${merchant.slug}`}
              className={`group overflow-hidden rounded-2xl border border-akiba-line bg-white transition hover:border-akiba-teal/40 hover:shadow-chip active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal ${
                expanded ? "w-auto" : "w-44 shrink-0 snap-start sm:w-auto"
              }`}
            >
              <span className="relative flex h-24 w-full items-center justify-center overflow-hidden bg-akiba-card">
                {merchant.bannerUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={merchant.bannerUrl} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transform-none motion-reduce:transition-none" />
                ) : merchant.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={merchant.logoUrl} alt="" className="h-16 w-16 object-contain p-1.5" />
                ) : (
                  <span className="font-sterling text-3xl font-semibold text-akiba-teal" aria-hidden="true">
                    {merchant.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                {merchant.bannerUrl && merchant.logoUrl && (
                  <span className="absolute bottom-2 left-2 flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl bg-white p-1 shadow-chip">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={merchant.logoUrl} alt="" className="h-full w-full object-contain" />
                  </span>
                )}
              </span>
              <span className="block min-h-14 px-3 py-3 text-left text-sm font-semibold leading-snug text-akiba-ink group-hover:text-akiba-teal">
                {merchant.name}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
