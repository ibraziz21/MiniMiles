import { MapPin, Phone, MessageCircle, Navigation } from "lucide-react";
import type { PublicMerchantLocation } from "@/lib/merchants/types";
import { isOpenNow, formatTodayHours } from "@/lib/merchants/opening-hours";
import { buildDirectionsUrl, formatAddress } from "@/lib/merchants/directions";

export function BranchCard({ location }: { location: PublicMerchantLocation }) {
  const open = isOpenNow(location.openingHours, location.timezone);
  const todayHours = formatTodayHours(location.openingHours, location.timezone);

  return (
    <div className="rounded-2xl border border-akiba-line bg-white p-4">
      <div className="mb-1 flex items-start justify-between gap-2">
        <h3 className="font-semibold text-akiba-ink">{location.name}</h3>
        {open !== null && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${open ? "bg-akiba-tint text-akiba-teal" : "bg-akiba-card text-akiba-muted"}`}>
            {open ? "Open now" : "Closed"}
          </span>
        )}
      </div>

      <p className="flex items-start gap-1.5 text-sm text-akiba-muted">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          {formatAddress(location)}
          {location.landmark && <span className="block text-xs">Near {location.landmark}</span>}
        </span>
      </p>

      <p className="mt-1.5 text-xs text-akiba-muted">{todayHours}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={buildDirectionsUrl(location)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-full border border-akiba-line px-3 py-1.5 text-xs font-semibold text-akiba-ink hover:border-akiba-teal/40"
        >
          <Navigation className="h-3.5 w-3.5" /> Directions
        </a>
        {location.publicPhone && (
          <a
            href={`tel:${location.publicPhone}`}
            className="flex items-center gap-1.5 rounded-full border border-akiba-line px-3 py-1.5 text-xs font-semibold text-akiba-ink hover:border-akiba-teal/40"
          >
            <Phone className="h-3.5 w-3.5" /> Call
          </a>
        )}
        {location.publicWhatsapp && (
          <a
            href={`https://wa.me/${location.publicWhatsapp.replace(/[^\d]/g, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded-full border border-akiba-line px-3 py-1.5 text-xs font-semibold text-akiba-ink hover:border-akiba-teal/40"
          >
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        )}
      </div>

      {(location.acceptsAkibaPass || location.acceptsVouchers) && (
        <div className="mt-3 flex gap-2 text-[11px] text-akiba-muted">
          {location.acceptsAkibaPass && <span className="rounded-full bg-akiba-card px-2 py-0.5">Accepts Akiba Pass</span>}
          {location.acceptsVouchers && <span className="rounded-full bg-akiba-card px-2 py-0.5">Accepts vouchers</span>}
        </div>
      )}
    </div>
  );
}
