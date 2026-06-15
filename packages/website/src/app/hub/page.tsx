import type { Metadata } from "next";
import { DiscoveryFeed } from "@/components/DiscoveryFeed";
import { ButtonLink } from "@/components/ButtonLink";
import { WaitlistForm } from "@/components/WaitlistForm";
import { siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Hub",
  description:
    "Browse live AkibaMiles campaigns, partner quests, games, merchant vouchers, and upcoming rewards. Open the Akiba Hub App for personalized recommendations.",
};

const categoryTiles = [
  {
    icon: "💳",
    label: "MiniPay Rewards",
    description: "USDT holding campaigns and daily wallet reward draws.",
    via: "MiniPay",
    viaColor: "bg-blue-50 text-blue-700",
  },
  {
    icon: "🎯",
    label: "Partner Quests",
    description: "Complete partner quests and earn AkibaMiles for every verified action.",
    via: "MiniPay",
    viaColor: "bg-blue-50 text-blue-700",
  },
  {
    icon: "🎮",
    label: "Games",
    description: "Skill games, USDT pots, and leaderboard reward pools.",
    via: "MiniPay",
    viaColor: "bg-blue-50 text-blue-700",
  },
  {
    icon: "🛍️",
    label: "Merchants & Vouchers",
    description: "Redeem Miles for vouchers and shop with Akiba merchant partners.",
    via: "MiniPay",
    viaColor: "bg-blue-50 text-blue-700",
  },
  {
    icon: "🔵",
    label: "Base Campaigns",
    description: "On-chain quests, games, and reward campaigns across the Base ecosystem.",
    via: "Base App",
    viaColor: "bg-indigo-50 text-indigo-700",
  },
  {
    icon: "⚡",
    label: "Rewards",
    description: "New rewarded actions and bonus opportunities across the ecosystem.",
    via: "MiniPay",
    viaColor: "bg-blue-50 text-blue-700",
  },
];

export default function HubPage() {
  return (
    <main>
      {/* ── Hero ── */}
      <section className="bg-akiba-ink px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-2xl text-center">
            <p className="font-sterling text-base font-medium text-[#74D4DF]">Akiba Hub</p>
            <h1 className="mt-3 font-sterling text-4xl font-medium leading-[1.06] text-white sm:text-5xl">
              Discover what&apos;s happening in Akiba
            </h1>
            <p className="mt-4 text-lg leading-8 text-white/60">
              Browse live campaigns, quests, games, raffles, and vouchers across the Akiba
              ecosystem. Open the Akiba Hub App to connect your wallet and get personalized
              recommendations.
            </p>
            <WaitlistForm />
            <p className="mt-2 text-sm text-white/40">
              Already using Akiba?{" "}
              <a href={siteConfig.appUrl} className="text-white/60 underline underline-offset-2 hover:text-white">
                Open the web app →
              </a>
            </p>
          </div>
        </div>
      </section>

      {/* ── Category tiles ── */}
      <section className="border-b border-akiba-line bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="mb-6 text-xs font-semibold uppercase tracking-widest text-akiba-muted">
            Reward categories
          </p>
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
            {categoryTiles.map((tile) => (
              <a
                key={tile.label}
                href={siteConfig.appUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex flex-col gap-3 rounded-lg border border-akiba-line bg-akiba-paper p-4 no-underline transition hover:border-akiba-teal hover:bg-akiba-tint"
              >
                <span className="text-2xl" aria-hidden="true">
                  {tile.icon}
                </span>
                <div className="flex-1">
                  <p className="font-sterling text-sm font-semibold leading-snug text-akiba-ink">
                    {tile.label}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-akiba-muted line-clamp-2">
                    {tile.description}
                  </p>
                </div>
                <span
                  className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tile.viaColor}`}
                >
                  via {tile.via}
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── Discovery feed ── */}
      <section id="campaigns" className="bg-akiba-paper px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="mb-6 text-xs font-semibold uppercase tracking-widest text-akiba-muted">
            Live campaigns
          </p>
          <DiscoveryFeed />
        </div>
      </section>

      {/* ── Partner band ── */}
      <section className="bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col items-start justify-between gap-4 rounded-lg bg-akiba-ink px-6 py-8 sm:flex-row sm:items-center sm:px-10">
            <div>
              <p className="font-sterling text-lg font-semibold text-white">
                Launch a campaign with Akiba
              </p>
              <p className="mt-1 text-sm text-white/50">
                Reach users through quests, vouchers, games, and reward recommendations — across
                MiniPay, Base, and the Akiba Hub App.
              </p>
            </div>
            <ButtonLink href="/partners" variant="secondary" className="shrink-0 bg-white">
              Partner With Akiba
            </ButtonLink>
          </div>
        </div>
      </section>
    </main>
  );
}
