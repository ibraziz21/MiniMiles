"use client";

import { useState } from "react";
import Image from "next/image";
import { SkillGameCard } from "@/components/games/game-card";
import { LeaderboardCard } from "@/components/games/leaderboard-card";
import { MilesAmount } from "@/components/games/miles-amount";
import { GAME_CONFIGS } from "@/lib/games/config";
import { Trophy, Lightning, Brain } from "@phosphor-icons/react";
import { akibaMilesSymbolAlt } from "@/lib/svg";

export default function GamesPage() {
  const games = [GAME_CONFIGS.rule_tap, GAME_CONFIGS.memory_flip];

  return (
    <main className="pb-28 font-sterling min-h-screen bg-[#F7FEFF]">
      {/* Hero header */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#0D7A8A] via-[#238D9D] to-[#2CBDD4] px-4 pb-8 pt-10">
        {/* Decorative circles */}
        <div className="absolute -right-8 -top-8 h-40 w-40 rounded-full bg-white/10" />
        <div className="absolute -bottom-10 -left-6 h-32 w-32 rounded-full bg-white/10" />
        <div className="absolute right-16 top-16 h-16 w-16 rounded-full bg-white/10" />

        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Image src={akibaMilesSymbolAlt} width={22} height={22} alt="AkibaMiles" />
            <span className="text-sm font-semibold text-white/90">AkibaMiles</span>
          </div>
          <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold text-white">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#4EFFA0]" />
            Skill Games · Live
          </div>
          <h1 className="mt-2 text-3xl font-bold text-white">Play & Earn</h1>
          <p className="mt-1 font-poppins text-sm text-white/80">
            Short skill rounds. Onchain entry. Verifier-backed rewards.
          </p>

          {/* Quick stat pills */}
          <div className="mt-4 flex gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs text-white">
              <Trophy size={13} weight="fill" className="text-yellow-300" />
              <span>Up to</span>
              <MilesAmount value={35} size={13} variant="alt" className="font-semibold" />
              <span>/round</span>
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1.5 text-xs text-white">
              <Lightning size={13} weight="fill" className="text-cyan-200" />
              <MilesAmount value={5} size={13} variant="alt" className="font-semibold" />
              <span>entry</span>
            </div>
          </div>
        </div>
      </div>

      {/* Game cards */}
      <div className="px-4 pt-5 space-y-4">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#817E7E]">Choose a game</p>
        {games.map((config) => (
          <SkillGameCard key={config.type} config={config} />
        ))}
      </div>

      {/* Leaderboard section */}
      <div className="mt-6 px-4">
        <TabbedLeaderboard />
      </div>
    </main>
  );
}

function TabbedLeaderboard() {
  const [tab, setTab] = useState<"rule_tap" | "memory_flip">("rule_tap");

  return (
    <div>
      <div className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#817E7E]">Leaderboards</p>
        <p className="text-xs text-[#525252] font-poppins mt-0.5">Switch between daily and weekly inside each card</p>
      </div>
      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={() => setTab("rule_tap")}
          className={[
            "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all",
            tab === "rule_tap"
              ? "bg-[#238D9D] text-white shadow-md"
              : "bg-white border border-[#E0E0E0] text-[#525252]",
          ].join(" ")}
        >
          <Lightning size={14} weight={tab === "rule_tap" ? "fill" : "regular"} />
          Rule Tap
        </button>
        <button
          type="button"
          onClick={() => setTab("memory_flip")}
          className={[
            "flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-all",
            tab === "memory_flip"
              ? "bg-[#238D9D] text-white shadow-md"
              : "bg-white border border-[#E0E0E0] text-[#525252]",
          ].join(" ")}
        >
          <Brain size={14} weight={tab === "memory_flip" ? "fill" : "regular"} />
          Memory Flip
        </button>
      </div>
      <LeaderboardCard gameType={tab} />
    </div>
  );
}
