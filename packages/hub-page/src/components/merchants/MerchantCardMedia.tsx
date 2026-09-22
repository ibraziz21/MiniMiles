import { Store } from "lucide-react";
import type { MerchantValueSummary } from "@/lib/home/types";

/**
 * Shared header-image treatment (three tiers, richest to plainest), used by
 * both the recommendation card (MerchantValueCard) and the directory card
 * (MerchantDirectoryCard) so the fallback logic lives in one place:
 *  1. m.bannerUrl (a merchant-uploaded cover photo) — shown full-bleed,
 *     with the logo as a small overlapping badge if there is one.
 *  2. logo only — a soft blurred backdrop built from the same logo
 *     (so every merchant gets some color/texture, not a flat block)
 *     behind a crisp logo badge, instead of a tiny logo floating in
 *     dead space.
 *  3. neither — a brand-gradient placeholder with a store icon badge.
 */
export function MerchantCardMedia({ merchant: m }: { merchant: MerchantValueSummary }) {
  return (
    <div className="relative h-32 overflow-hidden bg-gradient-to-br from-akiba-tint to-akiba-card">
      {m.bannerUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={m.bannerUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover transition group-hover:scale-105"
        />
      ) : m.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={m.logoUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-150 object-cover opacity-30 blur-2xl"
        />
      ) : null}

      {!m.bannerUrl && (
        <div className="absolute inset-0 flex items-center justify-center">
          {m.logoUrl ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 shadow-soft ring-1 ring-black/5 transition group-hover:scale-105">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.logoUrl} alt={m.name} className="h-full w-full object-contain" />
            </div>
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-soft ring-1 ring-black/5">
              <Store className="h-7 w-7 text-akiba-teal" />
            </div>
          )}
        </div>
      )}

      {m.bannerUrl && m.logoUrl && (
        <div className="absolute bottom-2 left-2 flex h-10 w-10 items-center justify-center rounded-xl bg-white p-1.5 shadow-soft ring-1 ring-black/5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={m.logoUrl} alt={m.name} className="h-full w-full object-contain" />
        </div>
      )}
    </div>
  );
}
