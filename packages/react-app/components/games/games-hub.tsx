"use client";

// Games hub = weekly stage + prize inbox + launcher.
// Visual hierarchy matches strategic hierarchy:
//   1. WeeklyChallengeHero — THE feature: sponsor, prize tiers, countdown,
//      with the two weekly games playable from inside the hero.
//   2. My Prizes strip — cross-game inbox (hidden when empty).
//   3. Compact grid — evergreen games are launchers, not pitches.
// Each game still owns its win surface/claim flow — no unified settlement.

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import posthog from "posthog-js";
import {
  Lightning,
  Brain,
  DiceSix,
  Gift,
  LockKey,
  Lock,
  ArrowRight,
  Timer,
  Trophy,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { MyPrizesStrip } from "@/components/games/MyPrizesStrip";
import { useWeeklyCampaign, type WeeklyCampaign } from "@/hooks/games/useWeeklyCampaign";
import { useWeeklyLeaderboard } from "@/hooks/games/useWeeklyLeaderboard";
import { useWeekCountdown } from "@/hooks/games/useWeekCountdown";
import type { GameType } from "@/lib/games/types";

const WEEKLY_GAME_TYPES: GameType[] = ["rule_tap", "memory_flip"];

type GameSection = "pvp" | "jackpot" | "machines";

type WeeklyGame = {
  key: string;
  name: string;
  gameType: GameType;
  route: string;
  icon: PhosphorIcon;
};

type HubGame = {
  key: string;
  name: string;
  hook: string; // one line, compact tile
  section: GameSection;
  route: string;
  status: "live" | "soon";
  accent: string;
  surface: string;
  icon: PhosphorIcon;
};

/* ─── Catalog ────────────────────────────────────────────────────────────── */

const WEEKLY_GAMES: WeeklyGame[] = [
  { key: "rule_tap",    name: "Rule Tap",    gameType: "rule_tap",    route: "/games/rule-tap",    icon: Lightning },
  { key: "memory_flip", name: "Memory Flip", gameType: "memory_flip", route: "/games/memory-flip", icon: Brain },
];

const GAMES: HubGame[] = [
  {
    key: "farkle",
    name: "PvP Farkle",
    hook: "Live 1v1 duel — winner takes the pot",
    section: "pvp",
    route: "/games/farkle",
    status: "live",
    accent: "#238D9D",
    surface: "#EAF7F8",
    icon: DiceSix,
  },
  {
    key: "crackpot",
    name: "CrackPot",
    hook: "Crack the code, take the Miles pot",
    section: "jackpot",
    route: "/crackpot",
    status: "live",
    accent: "#176B76",
    surface: "#E8F3F4",
    icon: LockKey,
  },
  {
    key: "claw",
    name: "Akiba Claw",
    hook: "Grab real merchant vouchers",
    section: "machines",
    route: "/claw",
    status: "live",
    accent: "#2BA9B8",
    surface: "#E7F8FA",
    icon: Gift,
  },
];

function weeklyCampaignApplies(campaign: WeeklyCampaign | null): boolean {
  if (!campaign?.merchant) return false;
  return campaign.gameTypes.some((gt) => WEEKLY_GAME_TYPES.includes(gt as GameType));
}

/* ─── Weekly rank chip ───────────────────────────────────────────────────── */

function WeeklyRankChip({ gameType }: { gameType: GameType }) {
  const { myBest } = useWeeklyLeaderboard(gameType);

  useEffect(() => {
    if (myBest) posthog.capture("rank_chip_impression", { game: gameType, rank: myBest.rank });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameType, myBest?.rank]);

  if (!myBest) return null;

  const label = myBest.rank <= 20 ? `#${myBest.rank}` : "Played ✓";

  return (
    <span className="shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-300/30">
      {label}
    </span>
  );
}

/* ─── Weekly Challenge hero ──────────────────────────────────────────────── */
// The page's centerpiece. Sponsor + tiers + countdown + the two weekly games
// playable from inside the block. Renders with generic copy when no campaign
// is active — the weekly rhythm exists either way.

function WeeklyChallengeHero({ campaign }: { campaign: WeeklyCampaign | null }) {
  const countdown = useWeekCountdown();
  const sponsored = weeklyCampaignApplies(campaign);
  const merchant = sponsored ? campaign!.merchant : null;
  const tiers = sponsored ? campaign!.tiers.slice(0, 3) : [];

  useEffect(() => {
    if (merchant) posthog.capture("sponsored_header_impression", { merchant_id: merchant.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant?.id]);

  const trackStandingsTap = () => posthog.capture("hero_standings_tap");

  return (
    <section className="mx-4 mt-3 overflow-hidden rounded-2xl bg-[#062329] shadow-lg">
      <div className="relative p-3">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_10%,rgba(45,169,184,0.35),transparent_36%)]" />

        {/* Body — tap anywhere here to see full standings */}
        <Link href="/games/challenge" onClick={trackStandingsTap} className="relative block">
          {/* Title row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Trophy size={15} weight="fill" className="text-amber-400" />
              <h2 className="text-[15px] font-extrabold text-white">Weekly Challenge</h2>
            </div>
            <div className="flex shrink-0 items-center gap-1 rounded-full bg-white/10 px-2 py-1">
              <Timer size={10} weight="fill" className="text-[#83E8F2]" />
              <span className="text-[11px] font-bold tabular-nums text-white">{countdown}</span>
            </div>
          </div>

          {/* Sponsor row */}
          <div className="mt-1.5 flex items-center gap-2">
            {merchant?.imageUrl && (
              <div className="relative h-7 w-7 shrink-0 overflow-hidden rounded-lg border border-white/15 bg-white/10">
                <Image src={merchant.imageUrl} alt={merchant.name} fill className="object-cover" />
              </div>
            )}
            <p className="text-[12px] leading-snug text-white/80 font-poppins">
              {merchant ? (
                <>
                  Top 3 win <span className="font-bold text-white">{merchant.name}</span> vouchers
                  {merchant.country ? ` (${merchant.country})` : ""}
                </>
              ) : (
                <>Top 3 in each game win prizes every week</>
              )}
            </p>
          </div>

          {/* Prize tiers */}
          {tiers.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {tiers.map((t) => (
                <span
                  key={t.rank}
                  className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white ring-1 ring-white/15"
                >
                  {t.rank === 1 ? "🏆" : t.rank === 2 ? "🥈" : "🥉"} {t.label}
                </span>
              ))}
            </div>
          )}
        </Link>

        {/* Games — playable from inside the hero */}
        <div className="relative mt-3 grid grid-cols-2 gap-2">
          {WEEKLY_GAMES.map((g) => {
            const Icon = g.icon;
            return (
              <Link
                key={g.key}
                href={g.route}
                onClick={() => posthog.capture("section_game_tap", { section: "weekly", game: g.key })}
                className="group rounded-xl border border-white/12 bg-white/[0.07] p-2.5 transition-colors hover:bg-white/[0.12] active:scale-[0.98]"
                aria-label={`Play ${g.name}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#83E8F2]/15 text-[#83E8F2]">
                    <Icon size={18} weight="duotone" />
                  </div>
                  <WeeklyRankChip gameType={g.gameType} />
                </div>
                <p className="mt-1.5 truncate text-[13px] font-bold text-white">{g.name}</p>
                <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#83E8F2]">
                  Play <ArrowRight size={11} weight="bold" />
                </div>
              </Link>
            );
          })}
        </div>

        {/* View standings — subtle affordance at the hero's bottom edge */}
        <Link
          href="/games/challenge"
          onClick={trackStandingsTap}
          className="relative mt-3 flex items-center justify-center gap-1 border-t border-white/10 pt-2.5 text-[11px] font-bold text-[#83E8F2]"
        >
          View standings <ArrowRight size={11} weight="bold" />
        </Link>
      </div>
    </section>
  );
}

/* ─── Compact game tile (evergreen launchers) ────────────────────────────── */

function CompactGameTile({ game }: { game: HubGame }) {
  const isLive = game.status === "live";
  const Icon = game.icon;

  const tile = (
    <div
      className={`h-full rounded-xl border bg-white p-2.5 shadow-sm ${
        isLive ? "transition hover:border-[#238D9D]/30 hover:shadow-md active:scale-[0.98]" : "opacity-70"
      }`}
      style={{ borderColor: "#E3ECEE" }}
    >
      <div className="flex items-center justify-between">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg border"
          style={{ background: game.surface, borderColor: `${game.accent}24`, color: game.accent }}
        >
          <Icon size={16} weight="duotone" />
        </div>
        {!isLive && <Lock size={12} weight="fill" className="text-gray-400" />}
      </div>
      <p className="mt-1.5 truncate text-[13px] font-bold text-[#0D2B30]">{game.name}</p>
      <p className="mt-0.5 text-[10px] leading-tight text-[#667579] font-poppins line-clamp-2">
        {game.hook}
      </p>
    </div>
  );

  if (!isLive) return tile;

  return (
    <Link
      href={game.route}
      aria-label={`Play ${game.name}`}
      onClick={() => posthog.capture("section_game_tap", { section: game.section, game: game.key })}
      className="block h-full"
    >
      {tile}
    </Link>
  );
}

/* ─── Hub ────────────────────────────────────────────────────────────────── */

export function GamesHub() {
  const { campaign } = useWeeklyCampaign();

  useEffect(() => { posthog.capture("hub_view"); }, []);

  const live = GAMES.filter((g) => g.status === "live");
  const soon = GAMES.filter((g) => g.status === "soon");

  return (
    <main className="min-h-screen bg-[#F7FAFA] pb-20 font-sterling">
      <div className="px-4 pt-3 pb-1">
        <h1 className="text-xl font-bold text-[#0D2B30]">Games</h1>
      </div>

      {/* 1. The weekly stage — sponsor, prizes, countdown, playable games */}
      <WeeklyChallengeHero campaign={campaign} />

      {/* 2. Cross-game prize inbox (hidden when empty) */}
      <MyPrizesStrip />

      {/* 3. Evergreen launchers — one flat row, each game is its own economic contract */}
      {live.length > 0 && (
        <div className="mt-3 px-4">
          <p className="mb-2 text-[11px] font-semibold uppercase text-[#6E7C80]">More games</p>
          <div className="grid grid-cols-3 gap-2">
            {live.map((g) => (
              <CompactGameTile key={g.key} game={g} />
            ))}
          </div>
        </div>
      )}

      {/* Coming soon */}
      {soon.length > 0 && (
        <div className="mt-3 px-4">
          <p className="mb-2 text-[11px] font-semibold uppercase text-[#6E7C80]">Coming soon</p>
          <div className="grid grid-cols-3 gap-2">
            {soon.map((g) => (
              <CompactGameTile key={g.key} game={g} />
            ))}
          </div>
        </div>
      )}
    </main>
  );
}
