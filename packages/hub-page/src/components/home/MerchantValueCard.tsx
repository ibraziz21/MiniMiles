import { MapPin, Store, Globe, Tag } from "lucide-react";
import { MilesAmount } from "@/components/MilesIcon";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import type { MerchantValueSummary } from "@/lib/home/types";

/**
 * Shared merchant comparison card (spec §7) — used by both home's rails and
 * the `/merchants` directory (Phase 2 unification). Layout-agnostic: no
 * fixed width baked in, so a horizontal rail (`MerchantRail`) and a grid
 * (`MerchantFilters`) can each size it appropriately.
 */
export function MerchantValueCard({
  merchant: m,
  sectionId,
  position,
  event = "home_merchant_tap",
  eventProps,
}: {
  merchant: MerchantValueSummary;
  sectionId: string;
  position: number;
  /** Override for non-home callers so clicks aren't mislabeled as a home event. */
  event?: string;
  eventProps?: Record<string, unknown>;
}) {
  return (
    <TrackedLink
      href={`/merchants/${m.slug}`}
      event={event}
      eventProps={eventProps ?? { merchant_id: m.id, section_id: sectionId, position, reason_kinds: m.reasons.map((r) => r.kind) }}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-akiba-line bg-white transition hover:border-akiba-teal/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
    >
      {/*
        Header treatment (three tiers, richest to plainest):
         1. m.bannerUrl (a merchant-uploaded cover photo) — shown full-bleed,
            with the logo as a small overlapping badge if there is one.
         2. logo only — a soft blurred backdrop built from the same logo
            (so every merchant gets some color/texture, not a flat block)
            behind a crisp logo badge, instead of a tiny logo floating in
            dead space.
         3. neither — a brand-gradient placeholder with a store icon badge.
      */}
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

      <div className="flex flex-1 flex-col p-3.5">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold text-akiba-ink group-hover:text-akiba-teal">{m.name}</h3>
          {(m.operatingModel === "online") && (
            <Globe className="h-3.5 w-3.5 shrink-0 text-akiba-muted" aria-label="Online" />
          )}
        </div>

        {(m.primaryCategory || m.matchedOffering) && (
          <p className="mb-1.5 truncate text-xs text-akiba-muted">
            {m.matchedOffering ?? m.primaryCategory?.name}
          </p>
        )}

        {m.nearestLocation && (
          <p className="mb-1.5 flex items-center gap-1 text-xs text-akiba-muted">
            <MapPin className="h-3 w-3 shrink-0" />
            {m.nearestLocation.locality ? `${m.nearestLocation.locality}, ` : ""}
            {m.nearestLocation.city}
            {m.nearestLocation.distanceKm != null && ` · ${m.nearestLocation.distanceKm.toFixed(1)} km`}
          </p>
        )}

        {m.reasons.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {m.reasons.map((r, i) => (
              <span key={i} className="rounded-full bg-akiba-tint px-2 py-0.5 text-[11px] font-medium text-akiba-teal">
                {reasonText(r)}
              </span>
            ))}
          </div>
        )}

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {m.topOffer && (
              <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-akiba-ink">
                <Tag className="h-3 w-3 text-akiba-teal" />
                <MilesAmount amount={m.topOffer.milesCost} size="xs" />
              </span>
            )}
            {typeof m.voucherCount === "number" && m.voucherCount > 0 && (
              <span className="shrink-0 rounded-full bg-akiba-tint px-2 py-0.5 text-[11px] font-semibold text-akiba-teal">
                {m.voucherCount} voucher{m.voucherCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
          <span className="shrink-0 text-xs font-semibold text-akiba-teal group-hover:underline">View merchant →</span>
        </div>
      </div>
    </TrackedLink>
  );
}

function reasonText(reason: MerchantValueSummary["reasons"][number]): string {
  switch (reason.kind) {
    case "intent": return reason.label;
    case "distance": return `${reason.distanceKm.toFixed(1)} km away`;
    case "voucher": return reason.label;
    case "affordable": return "You can unlock this";
    case "affinity": return reason.label;
    case "earn": return reason.label;
    case "availability": return reason.label;
    case "new": return reason.label;
  }
}
