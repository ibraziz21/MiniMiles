"use client";

// Games hub = launcher. Each game owns its own tickets / leaderboard / economics
// on its own page, so the hub just presents the catalog and routes into them.

import { type ReactNode } from "react";
import Link from "next/link";
import {
  Lightning,
  Brain,
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
  stats: ReactNode[];
  route: string;
  status: "live" | "soon";
  accent: string;
  surface: string;
  icon: PhosphorIcon;
};

const GAMES: HubGame[] = [
  {
    key: "rule_tap",
    name: "Rule Tap",
    tagline: "Read the rule, tap the right tiles fast.",
    category: "Skill",
    stats: [
      <><MilesAmount value={5} size={11} /> / play</>,
      <>Win up to <MilesAmount value={12} size={11} /></>,
    ],
    route: "/games/rule-tap",
    status: "live",
    accent: "#238D9D",
    surface: "#EAF7F8",
    icon: Lightning,
  },
  {
    key: "memory_flip",
    name: "Memory Flip",
    tagline: "Match all 8 pairs before time runs out.",
    category: "Skill",
    stats: [
      <><MilesAmount value={5} size={11} /> / play</>,
      <>Win up to <MilesAmount value={12} size={11} /></>,
    ],
    route: "/games/memory-flip",
    status: "live",
    accent: "#176B76",
    surface: "#E8F3F4",
    icon: Brain,
  },
  {
    key: "claw",
    name: "Akiba Claw",
    tagline: "Grab the claw for real-world prizes.",
    category: "Prizes",
    stats: ["Miles entry", "Voucher prizes"],
    route: "/claw",
    status: "live",
    accent: "#2BA9B8",
    surface: "#E7F8FA",
    icon: Gift,
  },
  {
    key: "farkle",
    name: "PvP Farkle",
    tagline: "Push your luck — last to bank loses.",
    category: "PvP",
    stats: [
      <><MilesAmount value={20} size={11} /> entry</>,
      "Beat the table",
    ],
    route: "/rush",
    status: "soon",
    accent: "#7B8794",
    surface: "#F1F4F5",
    icon: DiceSix,
  },
  {
    key: "crackpot",
    name: "CrackPot",
    tagline: "Crack the secret code, take the jackpot.",
    category: "Jackpot",
    stats: [
      <><MilesAmount value={10} size={11} /> / attempt</>,
      "Winner takes the pot",
    ],
    route: "/crackpot",
    status: "soon",
    accent: "#7B8794",
    surface: "#F1F4F5",
    icon: LockKey,
  },
];

function HubGameCard({ game }: { game: HubGame }) {
  const isLive = game.status === "live";
  const Icon = game.icon;

  const card = (
    <div
      className={`rounded-lg border bg-white shadow-sm ${
        isLive ? "transition hover:border-[#238D9D]/30 hover:shadow-md active:scale-[0.995]" : "opacity-75"
      }`}
      style={{ borderColor: isLive ? "#E3ECEE" : "#E7EAEC" }}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border"
            style={{ background: game.surface, borderColor: `${game.accent}24`, color: game.accent }}
          >
            <Icon size={22} weight="duotone" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase text-[#6E7C80]">
                  {game.category}
                </p>
                <h2 className="mt-0.5 truncate text-base font-bold text-[#0D2B30]">
                  {game.name}
                </h2>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  isLive ? "bg-[#EAF7F8] text-[#238D9D]" : "bg-gray-100 text-gray-500"
                }`}
              >
                {isLive ? "Live" : "Soon"}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-[#667579] font-poppins">
              {game.tagline}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {game.stats.map((s, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-md border border-[#E5ECEE] bg-[#F8FBFB] px-2 py-1 text-[11px] font-medium text-[#405054]"
            >
              {s}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-end">
          {isLive ? (
            <div className="inline-flex items-center gap-1.5 text-sm font-bold text-[#238D9D]">
              Play <ArrowRight size={15} weight="bold" />
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-sm font-bold text-gray-500">
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
    <main className="min-h-screen bg-[#F7FAFA] pb-28 font-sterling">
      <div className="px-4 pt-5 pb-2">
        <h1 className="text-2xl font-bold text-[#0D2B30]">Games</h1>
        <p className="mt-1 text-sm text-[#667579] font-poppins">
          AkibaMiles challenges and reward games.
        </p>
      </div>

      <div className="mt-3 px-4">
        <p className="mb-2 text-[11px] font-semibold uppercase text-[#6E7C80]">
          Available
        </p>
      </div>

      <div className="px-4 space-y-3">
        {live.map((g) => (
          <HubGameCard key={g.key} game={g} />
        ))}
      </div>

      {/* Coming soon */}
      {soon.length > 0 && (
        <>
          <div className="mt-6 mb-2 px-4">
            <p className="text-[11px] font-semibold uppercase text-[#6E7C80]">
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
