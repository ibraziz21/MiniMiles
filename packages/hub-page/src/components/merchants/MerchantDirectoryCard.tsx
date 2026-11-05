import { ChevronRight } from "lucide-react";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { MerchantCardMedia } from "@/components/merchants/MerchantCardMedia";
import type { MerchantValueSummary } from "@/lib/home/types";

export function MerchantDirectoryCard({
  merchant: m,
  position,
  event = "merchant_directory_card_tap",
  eventProps,
}: {
  merchant: MerchantValueSummary;
  position: number;
  event?: string;
  eventProps?: Record<string, unknown>;
}) {
  const onlineOnly = m.operatingModel === "online";
  const location = m.nearestLocation;
  const area = location ? [...new Set([location.locality, location.city].filter(Boolean))].join(", ") : null;
  const category = m.primaryCategory?.name;
  const where = onlineOnly ? "Online only"
    : m.operatingModel === "hybrid" ? [area, "In store & online"].filter(Boolean).join(" · ")
    : area ?? "In store";

  return (
    <TrackedLink
      href={`/merchants/${m.slug}`}
      event={event}
      eventProps={eventProps ?? { merchant_id: m.id, position }}
      style={{ fontFamily: "var(--font-dm-sans, system-ui), sans-serif" }}
      className="flex min-h-[88px] w-full min-w-0 items-center gap-2 rounded-xl bg-white p-3 shadow-sm transition hover:bg-akiba-tint active:bg-akiba-teal/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
    >
      <MerchantCardMedia key={JSON.stringify([m.bannerUrl, m.logoUrl])} name={m.name} bannerUrl={m.bannerUrl} logoUrl={m.logoUrl} category={m.primaryCategory?.slug} onlineOnly={onlineOnly} />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-lg font-semibold leading-6 text-[#131B2E]">{m.name}</h3>
        {category && <p className="truncate text-xs leading-4 text-akiba-muted">{category}</p>}
        <p className="truncate text-xs font-normal leading-4 text-akiba-muted">{where}</p>
      </div>
      <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-[#404942]" />
    </TrackedLink>
  );
}
