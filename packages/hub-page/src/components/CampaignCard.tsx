import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Campaign } from "@/data/campaigns";

const statusConfig: Record<
  Campaign["status"],
  { label: string; classes: string; dot?: string }
> = {
  live: {
    label: "Live",
    classes: "bg-green-500/12 text-green-700",
    dot: "bg-green-500",
  },
  "starting-soon": {
    label: "Starting soon",
    classes: "bg-amber-500/12 text-amber-700",
  },
  "coming-soon": {
    label: "Coming soon",
    classes: "bg-akiba-tint text-akiba-teal",
  },
};

const categoryBorder: Record<Campaign["category"], string> = {
  "Wallet Rewards": "border-l-blue-400",
  "Partner Quests": "border-l-purple-400",
  Games: "border-l-orange-400",
  "Merchants & Vouchers": "border-l-pink-400",
  Rewards: "border-l-akiba-teal",
};

export function CampaignCard({ campaign }: { campaign: Campaign }) {
  const status = statusConfig[campaign.status];

  return (
    <article
      className={cn(
        "group flex flex-col rounded-lg border border-akiba-line border-l-4 bg-white transition hover:shadow-chip",
        campaign.status === "coming-soon" && "opacity-80",
        categoryBorder[campaign.category],
      )}
    >
      {/* Card body */}
      <div className="flex flex-1 flex-col gap-3 p-5">
        {/* Status + category */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              status.classes,
            )}
          >
            {status.dot && (
              <span
                className={cn("h-1.5 w-1.5 rounded-full", status.dot)}
                aria-hidden="true"
              />
            )}
            {status.label}
          </span>
          <span className="rounded-full bg-akiba-card px-2 py-0.5 text-xs text-akiba-muted">
            {campaign.category}
          </span>
        </div>

        {/* Title + partner */}
        <div>
          <h3 className="font-sterling text-lg font-semibold leading-snug text-akiba-ink">
            {campaign.title}
          </h3>
          <p className="mt-0.5 text-xs font-medium text-akiba-teal">{campaign.partner}</p>
        </div>

        {/* Tagline */}
        <p className="text-sm font-semibold text-akiba-ink">{campaign.tagline}</p>

        {/* Description */}
        <p className="text-sm leading-6 text-akiba-muted">{campaign.description}</p>

        {/* Details breakdown */}
        {campaign.details.length > 0 && (
          <dl className="rounded-md bg-akiba-paper px-3 py-3 text-xs">
            {campaign.details.map((d) => (
              <div key={d.label} className="flex items-baseline justify-between gap-2 py-0.5">
                <dt className="shrink-0 text-akiba-muted/70">{d.label}</dt>
                <dd className="text-right font-semibold text-akiba-ink">{d.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {/* CTA */}
      <div className="border-t border-akiba-line px-5 py-3">
        <a
          href={campaign.ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-sm font-semibold text-akiba-teal no-underline transition hover:gap-2"
          aria-label={`${campaign.cta} — ${campaign.title}`}
        >
          {campaign.cta}
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </div>
    </article>
  );
}
