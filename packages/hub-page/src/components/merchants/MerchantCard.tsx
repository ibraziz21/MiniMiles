import { MapPin, Store, Globe, Tag } from "lucide-react";
import type { PublicMerchantSummary } from "@/lib/merchants/types";

export function MerchantCard({ merchant: m }: { merchant: PublicMerchantSummary }) {
  return (
    <a
      href={`/merchants/${m.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-akiba-line bg-white transition hover:border-akiba-teal/40 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
    >
      <div className="flex h-36 items-center justify-center bg-akiba-card">
        {m.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.logoUrl} alt={m.name} className="max-h-24 max-w-[60%] object-contain transition group-hover:scale-105" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-akiba-teal/10">
            <Store className="h-8 w-8 text-akiba-teal" />
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <h2 className="font-semibold text-akiba-ink group-hover:text-akiba-teal">{m.name}</h2>
          <div className="flex shrink-0 gap-1">
            {(m.operatingModel === "physical" || m.operatingModel === "hybrid") && (
              <span className="flex items-center gap-1 rounded-full bg-akiba-card px-2 py-0.5 text-[11px] font-medium text-akiba-muted">
                <Store className="h-2.5 w-2.5" /> In store
              </span>
            )}
            {(m.operatingModel === "online" || m.operatingModel === "hybrid") && m.storeActive && (
              <span className="flex items-center gap-1 rounded-full bg-akiba-card px-2 py-0.5 text-[11px] font-medium text-akiba-muted">
                <Globe className="h-2.5 w-2.5" /> Online
              </span>
            )}
          </div>
        </div>

        {m.primaryCategory && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-akiba-tint px-2 py-0.5 text-[11px] font-semibold text-akiba-teal">
              {m.primaryCategory.name}
            </span>
            {m.categories
              .filter((c) => c.slug !== m.primaryCategory?.slug)
              .slice(0, 2)
              .map((c) => (
                <span key={c.slug} className="rounded-full bg-akiba-card px-2 py-0.5 text-[11px] text-akiba-muted">
                  {c.name}
                </span>
              ))}
          </div>
        )}

        {m.primaryLocation && (
          <p className="flex items-center gap-1 text-xs text-akiba-muted">
            <MapPin className="h-3 w-3" />
            {m.primaryLocation.locality ? `${m.primaryLocation.locality}, ` : ""}
            {m.primaryLocation.city}
            {m.branchCount > 1 && ` · ${m.branchCount} branches`}
            {m.distanceKm != null && ` · ${m.distanceKm.toFixed(1)} km`}
          </p>
        )}

        <div className="mt-4 flex items-center justify-between">
          {m.voucherCount > 0 ? (
            <span className="flex items-center gap-1 rounded-full bg-akiba-tint px-3 py-1 text-[11px] font-semibold text-akiba-teal">
              <Tag className="h-3 w-3" /> {m.voucherCount} voucher{m.voucherCount === 1 ? "" : "s"}
            </span>
          ) : (
            <span />
          )}
          <span className="text-xs font-semibold text-akiba-teal group-hover:underline">View merchant →</span>
        </div>
      </div>
    </a>
  );
}
