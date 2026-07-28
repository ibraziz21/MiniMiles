"use client";

// Home's campaign hero — a slimmer sibling of the games hub's
// WeeklyChallengeHero (components/games/games-hub.tsx): same dark-card
// styling constants, no game tiles (home stays light; play is one tap away
// at /games/challenge). See docs/home-page-redesign-spec.md §1.

import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Timer, Trophy } from "@phosphor-icons/react";
import { useWeekCountdown } from "@/hooks/games/useWeekCountdown";
import type { WeeklyCampaign } from "@/hooks/games/useWeeklyCampaign";

export function HomeCampaignHero({
  campaign,
  onTap,
}: {
  campaign: WeeklyCampaign;
  onTap?: () => void;
}) {
  const countdown = useWeekCountdown();
  const merchant = campaign.merchant!;
  const tiers = campaign.tiers.slice(0, 3);

  return (
    <section className="mx-4 mt-4">
      <Link
        href="/games/challenge"
        onClick={onTap}
        className="group block overflow-hidden rounded-2xl bg-[#062329] shadow-lg transition-transform active:scale-[0.99]"
        aria-label="View this week's challenge"
      >
        <div className="relative p-4">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(45,169,184,0.35),transparent_36%)]" />

          <div className="relative flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Trophy size={16} weight="fill" className="text-amber-400" />
              <h2 className="text-base font-extrabold text-white">Weekly Challenge</h2>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2.5 py-1">
              <Timer size={11} weight="fill" className="text-[#83E8F2]" />
              <span className="text-[11px] font-bold tabular-nums text-white">{countdown}</span>
            </div>
          </div>

          <div className="relative mt-2 flex items-center gap-2.5">
            {merchant.imageUrl && (
              <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-white/10">
                <Image src={merchant.imageUrl} alt={merchant.name} fill className="object-cover" />
              </div>
            )}
            <p className="text-[13px] leading-snug text-white/80 font-poppins">
              Top 3 win <span className="font-bold text-white">{merchant.name}</span> vouchers
              {merchant.country ? ` (${merchant.country})` : ""}
            </p>
          </div>

          {tiers.length > 0 && (
            <div className="relative mt-3 flex flex-wrap gap-1.5">
              {tiers.map((t) => (
                <span
                  key={t.rank}
                  className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white ring-1 ring-white/15"
                >
                  {t.rank === 1 ? "🏆" : t.rank === 2 ? "🥈" : "🥉"} {t.label}
                </span>
              ))}
            </div>
          )}

          <div className="relative mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-[#83E8F2]">
            Play &amp; win <ArrowRight size={14} weight="bold" />
          </div>
        </div>
      </Link>
    </section>
  );
}
