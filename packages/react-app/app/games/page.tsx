"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useWeb3 } from "@/contexts/useWeb3";
import MiniPointsCard from "@/components/mini-points-card";
import { Lightning, Brain, Users } from "@phosphor-icons/react";

export default function GamesPage() {
  const { address, getakibaMilesBalance } = useWeb3() as any;
  const [balance, setBalance] = useState("0");

  useEffect(() => {
    if (!address) return;
    getakibaMilesBalance?.().then(setBalance).catch(() => {});
  }, [address, getakibaMilesBalance]);

  return (
    <main className="pb-28 font-sterling bg-onboarding min-h-screen">

      {/* ── Page header ──────────────────────────────────── */}
      <div className="px-4 pt-8 flex flex-col gap-1 mb-4">
        <h1 className="text-2xl font-medium">Games</h1>
        <p className="font-poppins text-[#717171]">Play, compete &amp; win Miles</p>
      </div>

      <MiniPointsCard points={Number(balance)} />

      {/* ══════════════════════════════════════════════════
          SKILL GAMES
      ══════════════════════════════════════════════════ */}
      <div className="mx-4 mt-6">
        <h3 className="text-lg font-extrabold mb-3">Skill Games</h3>
        <Link
          href="/games/skill"
          className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-[#0A6B7A] via-[#0D7A8A] to-[#1A9AAD] p-4 shadow-md active:scale-[0.99] transition-transform relative overflow-hidden"
        >
          <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute left-0 -bottom-4 h-16 w-16 rounded-full bg-white/10" />
          <div className="relative z-10 flex items-center gap-4 w-full">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl bg-white/15 gap-1">
              <Lightning size={14} weight="fill" className="text-yellow-300" />
              <Brain size={14} weight="fill" className="text-purple-200" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white">Rule Tap &amp; Memory Flip</p>
              <p className="text-xs text-white/60 font-poppins mt-0.5">Short rounds · Win Miles · Leaderboards</p>
            </div>
            <span className="flex-shrink-0 rounded-full bg-white/20 px-3 py-1.5 text-xs font-bold text-white">
              Play →
            </span>
          </div>
        </Link>
      </div>

      {/* ══════════════════════════════════════════════════
          CHANCE
      ══════════════════════════════════════════════════ */}
      <div className="mx-4 mt-6">
        <h3 className="text-lg font-extrabold mb-3">Chance</h3>
        <div className="space-y-3">
          <Link
            href="/claw"
            className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-[#3A2C1A] to-[#5A3D1F] p-4 shadow-sm active:scale-[0.99] transition-transform"
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-xl">🕹</div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white">Akiba Claw</p>
              <p className="text-xs text-white/60 font-poppins mt-0.5">Grab rewards with a live play</p>
            </div>
            <LiveBadge />
          </Link>

          <Link
            href="/dice"
            className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-[#1A3A2A] to-[#204D38] p-4 shadow-sm active:scale-[0.99] transition-transform"
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-xl">🎲</div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-white">Dice</p>
              <p className="text-xs text-white/60 font-poppins mt-0.5">Pick a number · Win the pot</p>
            </div>
            <LiveBadge />
          </Link>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          PvP
      ══════════════════════════════════════════════════ */}
      <div className="mx-4 mt-6">
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-lg font-extrabold">PvP</h3>
          <span className="rounded-full bg-[#238D9D1A] px-2 py-0.5 text-[10px] font-semibold text-[#238D9D]">Beta</span>
        </div>

        <Link
          href="/games/farkle"
          className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-[#1A0A3A] to-[#2D1260] p-4 shadow-sm active:scale-[0.99] transition-transform mb-3"
        >
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-xl">⚔️</div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white">Farkle Duel</p>
            <p className="text-xs text-white/60 font-poppins mt-0.5">2-player dice duel · Win Miles</p>
          </div>
          <LiveBadge />
        </Link>

        <Link
          href="/crackpot"
          className="flex items-center gap-4 rounded-2xl bg-gradient-to-r from-[#0A3D4A] to-[#0D6070] p-4 shadow-sm active:scale-[0.99] transition-transform mb-3"
        >
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-xl">🔮</div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white">CrackPot</p>
            <p className="text-xs text-white/60 font-poppins mt-0.5">Crack the code · Win the pot</p>
          </div>
          <LiveBadge />
        </Link>

        <div className="rounded-2xl border border-dashed border-[#238D9D40] bg-[#F0FDFF] px-4 py-5 flex items-center gap-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#238D9D1A]">
            <Users size={20} className="text-[#238D9D]" />
          </div>
          <div>
            <p className="font-semibold text-[#1A1A1A] text-sm">More PvP games coming</p>
            <p className="text-xs text-[#717171] font-poppins mt-0.5">Challenge other players for Miles</p>
          </div>
        </div>
      </div>

    </main>
  );
}

function LiveBadge() {
  return (
    <span className="flex items-center gap-1 rounded-full bg-[#4EFFA0]/20 px-2.5 py-1 text-xs font-semibold text-[#4EFFA0] flex-shrink-0">
      <span className="h-1.5 w-1.5 rounded-full bg-[#4EFFA0] animate-pulse" />
      Live
    </span>
  );
}
