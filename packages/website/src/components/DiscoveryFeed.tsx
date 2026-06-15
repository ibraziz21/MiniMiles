"use client";

import { useState } from "react";
import { CampaignCard } from "@/components/CampaignCard";
import { campaigns, type CampaignCategory } from "@/data/campaigns";
import { cn } from "@/lib/utils";

const ALL = "All";

const filters: (typeof ALL | CampaignCategory)[] = [
  ALL,
  "Wallet Rewards",
  "Partner Quests",
  "Games",
  "Merchants & Vouchers",
  "Rewards",
];

const filterEmoji: Record<typeof ALL | CampaignCategory, string> = {
  All: "",
  "Wallet Rewards": "💳",
  "Partner Quests": "🎯",
  Games: "🎮",
  "Merchants & Vouchers": "🛍️",
  Rewards: "⚡",
};

export function DiscoveryFeed() {
  const [active, setActive] = useState<typeof ALL | CampaignCategory>(ALL);

  const visible =
    active === ALL ? campaigns : campaigns.filter((c) => c.category === active);

  const liveCount = visible.filter((c) => c.status === "live").length;
  const soonCount = visible.filter(
    (c) => c.status === "starting-soon" || c.status === "coming-soon",
  ).length;

  return (
    <div>
      {/* Filter chips */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-5 sm:mx-0 sm:px-0">
        {filters.map((f) => (
          <button
            key={f}
            onClick={() => setActive(f)}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition",
              active === f
                ? "border-akiba-teal bg-akiba-teal text-white"
                : "border-akiba-line bg-white text-akiba-muted hover:border-akiba-teal hover:text-akiba-teal",
            )}
          >
            {filterEmoji[f] && <span aria-hidden="true">{filterEmoji[f]}</span>}
            {f}
          </button>
        ))}
      </div>

      {/* Count line */}
      <p className="mb-5 text-xs text-akiba-muted">
        {liveCount > 0 && (
          <span>
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-green-500 align-middle" />
            {liveCount} live
          </span>
        )}
        {liveCount > 0 && soonCount > 0 && <span className="mx-1.5">·</span>}
        {soonCount > 0 && <span>{soonCount} coming soon</span>}
      </p>

      {/* Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((campaign) => (
          <CampaignCard key={campaign.id} campaign={campaign} />
        ))}
      </div>
    </div>
  );
}
