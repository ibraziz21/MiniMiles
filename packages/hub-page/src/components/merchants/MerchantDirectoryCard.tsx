import { MapPin, Globe, Clock, Tag } from "lucide-react";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { MerchantCardMedia } from "@/components/merchants/MerchantCardMedia";
import { OperatingBadges } from "@/components/merchants/OperatingBadges";
import type { MerchantValueSummary } from "@/lib/home/types";

/**
 * Retrieval-context merchant card (discovery-blueprint.md §5) — used only by
 * the `/merchants` directory grid. Deliberately shows objective, comparable
 * facts only: no reason chips, no persuasive language. That's the
 * recommendation card's (MerchantValueCard) voice, not this one's — a
 * directory card's job is fast scanning across many peers, not making a
 * case for any single merchant.
 */
export function MerchantDirectoryCard({
  merchant: m,
  position,
}: {
  merchant: MerchantValueSummary;
  position: number;
}) {
  return (
    <TrackedLink
      href={`/merchants/${m.slug}`}
      event="merchant_directory_card_tap"
      eventProps={{ merchant_id: m.id, position }}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-akiba-line bg-white transition hover:border-akiba-teal/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
    >
      <MerchantCardMedia merchant={m} />

      <div className="flex flex-1 flex-col p-3.5">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <h3 className="truncate font-semibold text-akiba-ink group-hover:text-akiba-teal">{m.name}</h3>
          {m.operatingModel === "online" && (
            <Globe className="h-3.5 w-3.5 shrink-0 text-akiba-muted" role="img" aria-label="Online" />
          )}
        </div>

        {m.primaryCategory && (
          <p className="mb-1.5 truncate text-xs text-akiba-muted">{m.primaryCategory.name}</p>
        )}

        {m.nearestLocation && (
          <p className="mb-1.5 flex items-center gap-1 text-xs text-akiba-muted">
            <MapPin className="h-3 w-3 shrink-0" />
            {m.nearestLocation.locality ? `${m.nearestLocation.locality}, ` : ""}
            {m.nearestLocation.city}
            {m.nearestLocation.distanceKm != null && ` · ${m.nearestLocation.distanceKm.toFixed(1)} km`}
            {typeof m.branchCount === "number" && m.branchCount > 1 && ` · ${m.branchCount} branches`}
          </p>
        )}

        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {/* Opening hours aren't carried by the shared summary DTO yet
              (hardcoded "unknown" — see MerchantValueSummary.nearestLocation)
              so this stays inert until that's wired through in Phase 2. It's
              not a placeholder to fill in later — it's already correct code
              that will light up automatically once real data exists. */}
          {m.nearestLocation && m.nearestLocation.openStatus !== "unknown" && (
            <span className="flex items-center gap-1 rounded-full bg-akiba-card px-2.5 py-0.5 text-[11px] font-medium text-akiba-muted">
              <Clock className="h-3 w-3" />
              {m.nearestLocation.openStatus === "open" ? "Open now" : "Closed"}
            </span>
          )}
          <OperatingBadges operatingModel={m.operatingModel} />
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          {typeof m.voucherCount === "number" && m.voucherCount > 0 ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-akiba-tint px-2 py-0.5 text-[11px] font-semibold text-akiba-teal">
              <Tag className="h-3 w-3" />
              {m.voucherCount} voucher{m.voucherCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span />
          )}
          <span className="shrink-0 text-xs font-semibold text-akiba-teal group-hover:underline">View merchant →</span>
        </div>
      </div>
    </TrackedLink>
  );
}
