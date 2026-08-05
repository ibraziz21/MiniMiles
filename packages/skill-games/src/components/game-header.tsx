import Link from "next/link";
import type { ReactNode } from "react";
import { CaretLeft } from "@phosphor-icons/react";

const GAME_THEMES: Record<string, { gradient: string; badge: string }> = {
  "Rule Tap": {
    gradient: "from-[#0D7A8A] via-[#238D9D] to-[#1A9AAD]",
    badge: "⚡",
  },
  "Memory Flip": {
    gradient: "from-[#3B1F6E] via-[#5B35A0] to-[#7B4CC0]",
    badge: "🧠",
  },
};

export function GameHeader({
  title,
  subtitle,
  gamesHomeHref,
  brandLabel,
  milesIcon,
}: {
  title: string;
  subtitle: string;
  /** Where "All Games" links back to — differs per host (`/games`). */
  gamesHomeHref: string;
  brandLabel: string;
  milesIcon: ReactNode;
}) {
  const theme = GAME_THEMES[title] ?? GAME_THEMES["Rule Tap"];

  return (
    <div className={`relative bg-gradient-to-r ${theme.gradient} px-4 pb-5 pt-3 overflow-hidden`}>
      {/* Decorative */}
      <div className="absolute -right-6 -top-6 h-28 w-28 rounded-full bg-white/10" />
      <div className="absolute right-20 bottom-0 h-10 w-10 rounded-full bg-white/10" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-2">
          <Link href={gamesHomeHref} className="inline-flex items-center gap-1 text-sm font-medium text-white/80">
            <CaretLeft size={15} />
            All Games
          </Link>
          <div className="flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1">
            {milesIcon}
            <span className="text-[11px] font-semibold text-white/90">{brandLabel}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xl">{theme.badge}</span>
          <div>
            <h1 className="text-xl font-bold text-white leading-tight">{title}</h1>
            <p className="font-poppins text-xs text-white/70">{subtitle}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
