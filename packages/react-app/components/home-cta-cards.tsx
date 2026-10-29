"use client";

// Home primary CTAs — took the slot the daily-challenges rail used to hold
// (hidden behind DAILY_CHALLENGES_ENABLED in lib/featureFlags.ts). Order is
// deliberate: the Pass App first, since earning now happens at partner shops,
// then Games with Farkle ahead of Skill Games.

import Link from "next/link";
import posthog from "posthog-js";
import {
  QrCode,
  DiceSix,
  Lightning,
  ArrowRight,
  Trophy,
} from "@phosphor-icons/react";

type GameTile = {
  key: string;
  name: string;
  hook: string;
  route: string;
  icon: typeof DiceSix;
  badge?: string;
};

// Farkle first, Skill Games second.
const GAME_TILES: GameTile[] = [
  {
    key: "farkle",
    name: "Farkle",
    hook: "Live 1v1 dice duel — winner takes the pot",
    route: "/games/farkle",
    icon: DiceSix,
    badge: "1v1",
  },
  {
    key: "skill_games",
    name: "Skill Games",
    hook: "Rule Tap & Memory Flip — top 3 win every week",
    route: "/games",
    icon: Lightning,
  },
];

export default function HomeCtaCards({
  // The hero itself is a "Get my Akiba Pass" banner when no campaign or raffle
  // is live; home then skips this card rather than stacking two Pass CTAs.
  showPass = true,
}: { showPass?: boolean } = {}) {
  const track = (cta: string) => posthog.capture("home_cta_tap", { cta });

  return (
    <section className="mx-4 mt-6">
      {/* Pass App — the primary earn surface */}
      {showPass && (
      <Link
        href="/akiba-pass?src=home_cta"
        onClick={() => track("pass_app")}
        aria-label="Open the Akiba Pass app"
        className="block overflow-hidden rounded-2xl bg-[#062329] shadow-lg transition-transform active:scale-[0.99]"
      >
        <div className="relative p-4">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_88%_12%,rgba(45,169,184,0.35),transparent_38%)]" />

          <div className="relative flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#83E8F2]/15 text-[#83E8F2] ring-1 ring-[#83E8F2]/25">
              <QrCode size={22} weight="fill" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-[15px] font-extrabold text-white">Pass App</h3>
              <p className="mt-0.5 text-[12px] leading-snug text-white/75 font-poppins">
                Earn Miles at partner shops — one QR scan at the till.
              </p>
            </div>
            <ArrowRight size={16} weight="bold" className="shrink-0 text-[#83E8F2]" />
          </div>
        </div>
      </Link>
      )}

      {/* Games — Farkle, then Skill Games */}
      <div className={showPass ? "mt-6" : ""}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-medium">Games</h3>
          <Link href="/games" onClick={() => track("games_see_all")}>
            <span className="text-sm font-medium text-[#238D9D] hover:underline">
              See All ›
            </span>
          </Link>
        </div>
        <p className="text-gray-500">Play in the mini-app and win Miles & prizes</p>

        <div className="mt-2 grid grid-cols-2 gap-3">
          {GAME_TILES.map((game) => {
            const Icon = game.icon;
            return (
              <Link
                key={game.key}
                href={game.route}
                onClick={() => track(game.key)}
                aria-label={`Play ${game.name}`}
                className="block h-full rounded-xl border border-[#E3ECEE] bg-white p-3 shadow-sm transition hover:border-[#238D9D]/30 hover:shadow-md active:scale-[0.98]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#238D9D24] bg-[#EAF7F8] text-[#238D9D]">
                    <Icon size={18} weight="duotone" />
                  </div>
                  {game.badge ? (
                    <span className="rounded-full bg-[#EAF7F8] px-2 py-0.5 text-[10px] font-bold text-[#238D9D]">
                      {game.badge}
                    </span>
                  ) : (
                    <Trophy size={13} weight="fill" className="text-amber-400" />
                  )}
                </div>
                <p className="mt-2 truncate text-[14px] font-bold text-[#0D2B30]">
                  {game.name}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-[#667579] font-poppins line-clamp-2">
                  {game.hook}
                </p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
