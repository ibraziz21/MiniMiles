import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Campaign } from "@/data/campaigns";

const statusConfig: Record<
  Campaign["status"],
  { label: string; classes: string; dot?: string }
> = {
  live: {
    label: "Live",
    classes: "bg-green-500/10 text-green-700",
    dot: "bg-green-500",
  },
  "starting-soon": {
    label: "Starting soon",
    classes: "bg-amber-500/10 text-amber-700",
  },
  "coming-soon": {
    label: "Coming soon",
    classes: "bg-akiba-tint text-akiba-teal",
  },
};

const categoryAccent: Record<
  Campaign["category"],
  { border: string; highlight: string; label: string }
> = {
  "Wallet Rewards":      { border: "border-l-blue-400",   highlight: "bg-blue-50 text-blue-700",   label: "bg-blue-50 text-blue-600" },
  "Partner Quests":      { border: "border-l-purple-400", highlight: "bg-purple-50 text-purple-700", label: "bg-purple-50 text-purple-600" },
  Games:                 { border: "border-l-orange-400", highlight: "bg-orange-50 text-orange-700", label: "bg-orange-50 text-orange-600" },
  "Merchants & Vouchers":{ border: "border-l-pink-400",   highlight: "bg-pink-50 text-pink-700",   label: "bg-pink-50 text-pink-600" },
  Rewards:               { border: "border-l-akiba-teal", highlight: "bg-akiba-tint text-akiba-teal", label: "bg-akiba-tint text-akiba-teal" },
};

export function CampaignCard({ campaign }: { campaign: Campaign }) {
  const status = statusConfig[campaign.status];
  const accent = categoryAccent[campaign.category];

  return (
    <article
      className={cn(
        "group flex flex-col rounded-lg border border-akiba-line border-l-4 bg-white transition hover:shadow-soft",
        campaign.status === "coming-soon" && "opacity-80",
        accent.border,
      )}
    >
      {/* ── Top bar: status + reward highlight ── */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              status.classes,
            )}
          >
            {status.dot && (
              <span className={cn("h-1.5 w-1.5 rounded-full", status.dot)} aria-hidden="true" />
            )}
            {status.label}
          </span>
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", accent.label)}>
            {campaign.category}
          </span>
        </div>

        {/* Reward highlight — top right */}
        <div className={cn("shrink-0 rounded-xl px-3 py-2 text-right", accent.highlight)}>
          <p className="text-xl font-bold leading-none tracking-tight">
            {campaign.rewardHighlight}
          </p>
          <p className="mt-0.5 text-xs font-medium opacity-70">{campaign.rewardLabel}</p>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 flex-col gap-3 px-5 py-4">
        <div>
          <h3 className="font-sterling text-lg font-medium leading-snug text-akiba-ink">
            {campaign.title}
          </h3>
          <p className="mt-0.5 text-xs font-semibold text-akiba-teal">{campaign.partner}</p>
        </div>

        <p className="text-sm leading-6 text-akiba-muted">{campaign.description}</p>

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

      {/* ── CTA ── */}
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
