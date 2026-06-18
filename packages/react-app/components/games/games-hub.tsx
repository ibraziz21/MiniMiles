"use client";

// Games hub = launcher. Each game owns its own tickets / leaderboard / economics
// on its own page, so the hub just presents the catalog and routes into them.

import { type ReactNode } from "react";
import Link from "next/link";
import {
  Lightning,
  Brain,
  DiceFive,
  DiceSix,
  Gift,
  LockKey,
  Lock,
  ArrowRight,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import { MilesAmount } from "@/components/games/miles-amount";

type GameCategory = "Skill" | "Pot" | "Prizes" | "PvP" | "Jackpot";

type HubGame = {
  key: string;
  name: string;
  tagline: string;
  category: GameCategory;
  /** Short stat pills shown on the card */
  stats: ReactNode[];
  route: string;
  status: "live" | "soon";
  /** Tailwind gradient classes — each game gets its own colour identity */
  gradient: string;
  icon: PhosphorIcon;
};

const GAMES: HubGame[] = [
  {
    key: "rule_tap",
    name: "Rule Tap",
    tagline: "Read the rule, tap the right tiles fast.",
    category: "Skill",
    stats: [
      <><MilesAmount value={5} size={11} variant="alt" /> / play</>,
      <>Win up to <MilesAmount value={12} size={11} variant="alt" /></>,
    ],
    route: "/games/rule-tap",
    status: "live",
    gradient: "from-[#0A6B7A] via-[#0D7A8A] to-[#1A9AAD]",
    icon: Lightning,
  },
  {
    key: "memory_flip",
    name: "Memory Flip",
    tagline: "Match all 8 pairs before time runs out.",
    category: "Skill",
    stats: [
      <><MilesAmount value={5} size={11} variant="alt" /> / play</>,
      <>Win up to <MilesAmount value={12} size={11} variant="alt" /></>,
    ],
    route: "/games/memory-flip",
    status: "live",
    gradient: "from-[#3B1F6E] via-[#5035A0] to-[#7B4CC0]",
    icon: Brain,
  },
  {
    key: "claw",
    name: "Akiba Claw",
    tagline: "Grab the claw for real-world prizes.",
    category: "Prizes",
    stats: ["USDT entry", "Win vouchers & prizes"],
    route: "/claw",
    status: "live",
    gradient: "from-[#9E2A5B] via-[#C13B6E] to-[#E0588A]",
    icon: Gift,
  },
  {
    key: "farkle",
    name: "PvP Farkle",
    tagline: "Push your luck — last to bank loses.",
    category: "PvP",
    stats: [
      <><MilesAmount value={20} size={11} variant="alt" /> entry</>,
      "Beat the table",
    ],
    route: "/rush",
    status: "soon",
    gradient: "from-[#8A2B1E] via-[#B5432F] to-[#E06A4A]",
    icon: DiceSix,
  },
  {
    key: "crackpot",
    name: "CrackPot",
    tagline: "Crack the secret code, take the jackpot.",
    category: "Jackpot",
    stats: [
      <><MilesAmount value={10} size={11} variant="alt" /> / attempt</>,
      "Winner takes the pot",
    ],
    route: "/crackpot",
    status: "soon",
    gradient: "from-[#2E2A6E] via-[#403AA0] to-[#5B52C0]",
    icon: LockKey,
  },
];

function HubGameCard({ game }: { game: HubGame }) {
  const isLive = game.status === "live";
  const Icon = game.icon;

  const card = (
    <div
      className={`relative overflow-hidden rounded-2xl shadow-md bg-gradient-to-br ${game.gradient} ${
        isLive ? "active:scale-[0.99] transition-transform" : "opacity-95"
      }`}
    >
      {/* decorative blobs */}
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute right-16 bottom-0 h-12 w-12 rounded-full bg-white/10" />

      <div className="relative p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
              {game.category}
            </span>
            <h2 className="mt-2 text-xl font-bold text-white">{game.name}</h2>
            <p className="mt-0.5 text-xs text-white/75 font-poppins">{game.tagline}</p>
          </div>
          <div className="flex-shrink-0 rounded-xl bg-white/15 p-2.5">
            <Icon size={22} weight="fill" className="text-white" />
          </div>
        </div>

        {/* stat pills */}
        <div className="mt-3 flex flex-wrap gap-2">
          {game.stats.map((s, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] text-white/85"
            >
              {s}
            </span>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-3">
          {isLive ? (
            <div className="flex items-center justify-center gap-1.5 rounded-xl bg-white py-2.5 text-sm font-bold text-[#0D2B30]">
              Play <ArrowRight size={15} weight="bold" />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-1.5 rounded-xl border border-white/30 bg-white/20 py-2.5 text-sm font-bold text-white/90">
              <Lock size={14} weight="fill" /> Coming soon
            </div>
          )}
        </div>
      </div>
    </div>
  );

  if (!isLive) return card;
  return (
    <Link href={game.route} className="block" aria-label={`Play ${game.name}`}>
      {card}
    </Link>
  );
}

export function GamesHub() {
  const live = GAMES.filter((g) => g.status === "live");
  const soon = GAMES.filter((g) => g.status === "soon");

  return (
    <main className="pb-28 font-sterling min-h-screen bg-[#F5FEFF]">
      {/* Header */}
      <div className="px-4 pt-5 pb-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#238D9D]/70">
          Games
        </p>
        <h1 className="text-2xl font-bold text-[#0D2B30]">Play &amp; win</h1>
        <p className="mt-0.5 text-sm text-gray-500 font-poppins">
          Each game has its own tickets, prizes &amp; leaderboard.
        </p>
      </div>

      {/* Live games */}
      <div className="mt-4 px-4 space-y-3">
        {live.map((g) => (
          <HubGameCard key={g.key} game={g} />
        ))}
      </div>

      {/* Coming soon */}
      {soon.length > 0 && (
        <>
          <div className="mt-7 mb-2 px-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-[#817E7E]">
              Coming soon
            </p>
          </div>
          <div className="px-4 space-y-3">
            {soon.map((g) => (
              <HubGameCard key={g.key} game={g} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
