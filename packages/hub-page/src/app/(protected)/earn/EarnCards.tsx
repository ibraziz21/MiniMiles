"use client";

import Link from "next/link";
import { ShoppingBag, Zap, Gamepad2, Gift, ChevronRight } from "lucide-react";
import { track } from "@/lib/analytics/track";

export function ShopAndEarnCard() {
  return (
    <Link
      href="/merchants"
      onClick={() => track("earn_hub_item_tap", { item: "shop" })}
      className="block overflow-hidden rounded-2xl bg-gradient-to-r from-[#0D7A8A] via-[#238D9D] to-[#1A9AAD] p-6 shadow-sm transition active:scale-[0.99]"
    >
      <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white/90">
        <span className="h-1.5 w-1.5 rounded-full bg-[#4EFFA0]" />
        Primary way to earn
      </div>
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
          <ShoppingBag className="h-6 w-6 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-bold text-white">Shop & Earn</h2>
          <p className="mt-0.5 text-sm text-white/85">
            Show your Akiba Pass when you shop with participating merchants and earn Miles from eligible
            purchases.
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-white/70" />
      </div>
    </Link>
  );
}

const CARD_ICON = { quests: Zap, games: Gamepad2, referrals: Gift } as const;

export function EarnCard({
  item,
  href,
  title,
  description,
  summary,
}: {
  item: "quests" | "games" | "referrals";
  href: string;
  title: string;
  description: string;
  summary: string | null;
}) {
  const Icon = CARD_ICON[item];
  return (
    <Link
      href={href}
      onClick={() => track("earn_hub_item_tap", { item })}
      className="flex items-center gap-3 rounded-2xl border border-akiba-line bg-white p-4 transition hover:border-akiba-teal/40 active:scale-[0.99]"
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-akiba-tint text-akiba-teal">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-akiba-ink">{title}</h3>
        <p className="mt-0.5 text-sm text-akiba-muted">{summary ?? description}</p>
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 text-akiba-muted" />
    </Link>
  );
}
