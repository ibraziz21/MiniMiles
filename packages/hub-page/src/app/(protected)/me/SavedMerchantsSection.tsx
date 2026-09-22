import Link from "next/link";
import { Store } from "lucide-react";
import type { SavedMerchantSummary } from "@/lib/merchants/savedMerchants";

/**
 * Read-only list — unsaving happens from the merchant profile's own
 * SaveMerchantButton, not duplicated here (discovery-blueprint.md §6/§8).
 * Renders nothing when the member hasn't saved anything yet, rather than an
 * empty-state card for a feature they may not have discovered.
 */
export function SavedMerchantsSection({ merchants }: { merchants: SavedMerchantSummary[] }) {
  if (merchants.length === 0) return null;

  return (
    <section className="mb-4 sm:mb-6">
      <h2 className="mb-2.5 text-sm font-semibold uppercase tracking-wide text-akiba-muted sm:mb-3">
        Saved merchants
      </h2>
      <div className="divide-y divide-akiba-line overflow-hidden rounded-2xl border border-akiba-line bg-white">
        {merchants.map((m) => (
          <Link
            key={m.id}
            href={`/merchants/${m.slug}`}
            className="flex items-center gap-3 px-4 py-3 transition hover:bg-akiba-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-akiba-line bg-white">
              {m.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.logoUrl} alt={m.name} className="h-full w-full object-contain p-1" />
              ) : (
                <Store className="h-4 w-4 text-akiba-muted" aria-hidden="true" />
              )}
            </div>
            <span className="truncate text-sm font-medium text-akiba-ink">{m.name}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
