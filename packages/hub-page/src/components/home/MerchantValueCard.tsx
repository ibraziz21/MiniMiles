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
      <div className="flex h-28 items-center justify-center bg-akiba-card">
        {m.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.logoUrl} alt={m.name} className="max-h-16 max-w-[55%] object-contain transition group-hover:scale-105" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-akiba-teal/10">
            <Store className="h-6 w-6 text-akiba-teal" />
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
