"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LeaderboardCard } from "@/components/games/leaderboard-card";
import { BuyPlaysSheet } from "@/components/games/buy-plays-sheet";
import { useCredits } from "@/hooks/games/useCredits";
import { useLeaderboard } from "@/hooks/games/useLeaderboard";
import { useWeb3 } from "@/contexts/useWeb3";
import {
  Lightning, Brain, ShoppingCart, Ticket,
  Info, Trophy, Timer, ArrowLeft,
} from "@phosphor-icons/react";
import { MilesAmount } from "@/components/games/miles-amount";
import { GAME_CONFIGS as GC } from "@/lib/games/config";

function msUntilReset() {
  const now  = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.getTime() - now.getTime();
}

function useCountdown(targetMs: number) {
  const [timeLeft, setTimeLeft] = useState(targetMs);
  useEffect(() => {
    const interval = setInterval(() => setTimeLeft((prev) => Math.max(0, prev - 1000)), 1000);
    return () => clearInterval(interval);
  }, []);
  const h = Math.floor(timeLeft / 3_600_000);
  const m = Math.floor((timeLeft % 3_600_000) / 60_000);
  const s = Math.floor((timeLeft % 60_000) / 1_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function SkillGamesPage() {
  const { address } = useWeb3();
  const router = useRouter();

  const [buyPlaysOpen,   setBuyPlaysOpen]   = useState(false);
  const [activeGameType, setActiveGameType] = useState<"rule_tap" | "memory_flip">("rule_tap");
  const [lbTab,          setLbTab]          = useState<"rule_tap" | "memory_flip">("rule_tap");
  const [infoOpen,       setInfoOpen]       = useState(false);

  const rtCredits = useCredits("rule_tap",    address);
  const mfCredits = useCredits("memory_flip", address);
  const rtLb      = useLeaderboard("rule_tap");
  const mfLb      = useLeaderboard("memory_flip");

  const resetCountdown = useCountdown(msUntilReset());
  const rtStatus = rtCredits.status;
  const mfStatus = mfCredits.status;
  const noGameTickets  = rtStatus.credits === 0 && mfStatus.credits === 0;
  const bothDailyCapped = rtStatus.isDailyCapped && mfStatus.isDailyCapped;
  const rtDailyPct = Math.min(100, Math.round((rtStatus.playsToday / rtStatus.dailyCap) * 100));
  const mfDailyPct = Math.min(100, Math.round((mfStatus.playsToday / mfStatus.dailyCap) * 100));

  function openBuySheet(gameType: "rule_tap" | "memory_flip") {
    setActiveGameType(gameType);
    setBuyPlaysOpen(true);
  }

  const activeCreditStatus = activeGameType === "rule_tap" ? rtCredits.status     : mfCredits.status;
  const activeBuy          = activeGameType === "rule_tap" ? rtCredits.buyCredits : mfCredits.buyCredits;
  const activeBuying       = activeGameType === "rule_tap" ? rtCredits.buying     : mfCredits.buying;
  const activeBuyError     = activeGameType === "rule_tap" ? rtCredits.buyError   : mfCredits.buyError;

  const personalBests: Record<string, number | null> = {
    rule_tap:    rtLb.myBest?.score ?? null,
    memory_flip: mfLb.myBest?.score ?? null,
  };

  return (
    <main className="pb-28 font-sterling min-h-screen bg-[#F5FEFF]">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#0A6B7A] via-[#0D7A8A] to-[#1A9AAD] px-4 pt-10 pb-6">
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -left-6 bottom-0 h-28 w-28 rounded-full bg-white/10" />

        <div className="relative z-10">
          {/* Back + title row */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/games")}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 border border-white/20"
              >
                <ArrowLeft size={16} className="text-white" />
              </button>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-0.5">Games</p>
                <h1 className="text-2xl font-bold text-white">Skill Games</h1>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setInfoOpen((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 border border-white/20"
            >
              <Info size={17} className="text-white" />
            </button>
          </div>

          {/* Ticket + daily status */}
          <div className="rounded-2xl bg-white/15 border border-white/20 p-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/15 px-3 py-3">
                <div className="flex items-center gap-2">
                  <Lightning size={15} weight="fill" className="text-yellow-300" />
                  <p className="text-[11px] text-white/60 font-poppins">Rule Tap tickets</p>
                </div>
                <p className="text-2xl font-bold text-white leading-none mt-1">{rtStatus.credits}</p>
                <p className="mt-1 text-[11px] text-white/50">{rtStatus.playsToday}/{rtStatus.dailyCap} played today</p>
              </div>
              <div className="rounded-xl bg-white/15 px-3 py-3">
                <div className="flex items-center gap-2">
                  <Brain size={15} weight="fill" className="text-purple-200" />
                  <p className="text-[11px] text-white/60 font-poppins">Memory tickets</p>
                </div>
                <p className="text-2xl font-bold text-white leading-none mt-1">{mfStatus.credits}</p>
                <p className="mt-1 text-[11px] text-white/50">{mfStatus.playsToday}/{mfStatus.dailyCap} played today</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="h-1.5 w-full rounded-full bg-white/20">
                <div className="h-1.5 rounded-full bg-[#4EFFA0] transition-all duration-500" style={{ width: `${rtDailyPct}%` }} />
              </div>
              <div className="h-1.5 w-full rounded-full bg-white/20">
                <div className="h-1.5 rounded-full bg-[#C9B6FF] transition-all duration-500" style={{ width: `${mfDailyPct}%` }} />
              </div>
            </div>

            <div className="mt-3 flex items-center justify-between text-[11px] text-white/60 font-poppins">
              <span>Tickets are game-specific.</span>
              <span className="flex items-center gap-1 tabular-nums">
                <Timer size={11} />
                {resetCountdown}
              </span>
            </div>
          </div>

          {/* Buy tickets */}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => openBuySheet("rule_tap")}
              className="flex items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-bold text-[#0D7A8A]"
            >
              <ShoppingCart size={16} weight="fill" />
              Rule Tap
            </button>
            <button
              type="button"
              onClick={() => openBuySheet("memory_flip")}
              className="flex items-center justify-center gap-2 rounded-xl bg-white/90 py-3 text-sm font-bold text-[#5B35A0]"
            >
              <ShoppingCart size={16} weight="fill" />
              Memory
            </button>
          </div>
        </div>
      </div>

      {/* ── No-tickets nudge ─────────────────────────────── */}
      {address && noGameTickets && !bothDailyCapped && (
        <div className="mx-4 mt-4 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-4 flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
            <Ticket size={16} weight="fill" className="text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">No game tickets left</p>
            <p className="text-xs text-amber-700 font-poppins mt-0.5 flex items-center gap-1 flex-wrap">
              Rule Tap and Memory tickets are separate. Each ticket costs <MilesAmount value={5} size={12} />.
            </p>
            <div className="mt-2.5 flex gap-2">
              <button
                type="button"
                onClick={() => openBuySheet("rule_tap")}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-bold text-white"
              >
                Buy Rule Tap
              </button>
              <button
                type="button"
                onClick={() => openBuySheet("memory_flip")}
                className="rounded-lg bg-white px-4 py-1.5 text-xs font-bold text-amber-700 border border-amber-200"
              >
                Buy Memory
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── How it works (collapsible) ────────────────────── */}
      {infoOpen && (
        <div className="mx-4 mt-4 rounded-2xl bg-white border border-[#E8F7F9] shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-[#1A1A1A]">How skill games work</p>
            <button type="button" onClick={() => setInfoOpen(false)} className="text-xs text-[#817E7E] font-poppins">
              Close
            </button>
          </div>
          {([
            {
              icon: <Ticket size={15} weight="fill" className="text-[#0D7A8A]" />,
              title: "Buy game tickets",
              body: <span className="flex items-center gap-1 flex-wrap">Rule Tap and Memory tickets are separate. Each costs <MilesAmount value={5} size={12} />.</span>,
            },
            {
              icon: <Lightning size={15} weight="fill" className="text-[#0D7A8A]" />,
              title: "Play instantly",
              body: "Each round uses 1 ticket — no waiting, no extra steps.",
            },
            {
              icon: <Trophy size={15} weight="fill" className="text-amber-500" />,
              title: "Win rewards",
              body: <span className="flex items-center gap-1 flex-wrap">Score above the threshold to earn up to <MilesAmount value={12} size={12} /> per round.</span>,
            },
            {
              icon: <Timer size={15} weight="fill" className="text-[#0D7A8A]" />,
              title: "Daily limit",
              body: `${rtStatus.dailyCap} rounds per game per day. Resets at midnight UTC.`,
            },
          ] as const).map((item) => (
            <div key={item.title} className="flex items-start gap-3">
              <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#F0FDFF]">
                {item.icon}
              </div>
              <div>
                <p className="text-sm font-semibold text-[#1A1A1A]">{item.title}</p>
                <p className="text-xs text-[#525252] font-poppins leading-relaxed">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Game cards ────────────────────────────────────── */}
      <div className="px-4 mt-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-[#817E7E] mb-3">Choose a game</p>
        <div className="space-y-3">
          <GameCard
            gameType="rule_tap"
            tickets={rtStatus.credits}
            playsToday={rtStatus.playsToday}
            dailyCap={rtStatus.dailyCap}
            isDailyCapped={rtStatus.isDailyCapped}
            walletConnected={!!address}
            personalBest={personalBests.rule_tap}
            onPlay={() => router.push("/games/rule-tap")}
            onBuyTickets={() => openBuySheet("rule_tap")}
          />
          <GameCard
            gameType="memory_flip"
            tickets={mfStatus.credits}
            playsToday={mfStatus.playsToday}
            dailyCap={mfStatus.dailyCap}
            isDailyCapped={mfStatus.isDailyCapped}
            walletConnected={!!address}
            personalBest={personalBests.memory_flip}
            onPlay={() => router.push("/games/memory-flip")}
            onBuyTickets={() => openBuySheet("memory_flip")}
          />
        </div>
      </div>

      {/* ── Leaderboards ──────────────────────────────────── */}
      <div className="mt-6 px-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-[#817E7E]">Leaderboards</p>
          <div className="flex gap-1.5">
            {(["rule_tap", "memory_flip"] as const).map((gt) => (
              <button
                key={gt}
                type="button"
                onClick={() => setLbTab(gt)}
                className={[
                  "flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold transition-all",
                  lbTab === gt
                    ? "bg-[#ADF4FF80] text-[#238D9D]"
                    : "bg-[#EBEBEB] text-[#8E8B8B]",
                ].join(" ")}
              >
                {gt === "rule_tap" ? <Lightning size={11} weight="fill" /> : <Brain size={11} weight="fill" />}
                {gt === "rule_tap" ? "Rule Tap" : "Memory"}
              </button>
            ))}
          </div>
        </div>
        <LeaderboardCard gameType={lbTab} />
      </div>

      <BuyPlaysSheet
        open={buyPlaysOpen}
        onClose={() => setBuyPlaysOpen(false)}
        gameType={activeGameType}
        creditStatus={activeCreditStatus}
        onBuy={activeBuy}
        buying={activeBuying}
        buyError={activeBuyError}
      />
    </main>
  );
}

/* ── Rich game card ──────────────────────────────────────── */

const GAME_META = {
  rule_tap: {
    gradient: "from-[#0A6B7A] via-[#0D7A8A] to-[#1A9AAD]",
    iconBg:   "bg-yellow-400/20",
    icon:     <Lightning size={22} weight="fill" className="text-yellow-300" />,
    duration: "20s",
  },
  memory_flip: {
    gradient: "from-[#3B1F6E] via-[#5035A0] to-[#7B4CC0]",
    iconBg:   "bg-purple-300/20",
    icon:     <Brain size={22} weight="fill" className="text-purple-200" />,
    duration: "60s",
  },
} as const;

function GameCard({
  gameType, tickets, playsToday, dailyCap, isDailyCapped,
  walletConnected, personalBest, onPlay, onBuyTickets,
}: {
  gameType: "rule_tap" | "memory_flip";
  tickets: number; playsToday: number; dailyCap: number;
  isDailyCapped: boolean; walletConnected: boolean;
  personalBest: number | null; onPlay: () => void; onBuyTickets: () => void;
}) {
  const config = GC[gameType];
  const meta   = GAME_META[gameType];
  const ticketLabel = gameType === "rule_tap" ? "Rule Tap ticket" : "Memory ticket";

  let cta: { label: string; style: string; action: (() => void) | null };
  if (!walletConnected)   cta = { label: "Connect wallet",       style: "bg-white/20 text-white/60 cursor-not-allowed", action: null };
  else if (isDailyCapped) cta = { label: "Come back tomorrow",   style: "bg-white/20 text-white/60 cursor-not-allowed", action: null };
  else if (tickets <= 0)  cta = { label: `Buy ${gameType === "rule_tap" ? "Rule Tap" : "Memory"} tickets`, style: "bg-white/25 border border-white/40 text-white font-bold", action: onBuyTickets };
  else                    cta = { label: "Play →",                style: "bg-white text-[#0D7A8A] font-bold shadow-sm", action: onPlay };

  return (
    <div className={`rounded-2xl overflow-hidden shadow-md bg-gradient-to-br ${meta.gradient}`}>
      <div className="px-4 pt-4 pb-3 relative">
        <div className="pointer-events-none absolute -right-5 -top-5 h-24 w-24 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute right-14 bottom-0 h-10 w-10 rounded-full bg-white/10" />

        <div className="relative z-10 flex items-start justify-between mb-3">
          <div>
            <div className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-[10px] font-semibold text-white/90 mb-2">
              <span className="h-1.5 w-1.5 rounded-full bg-[#4EFFA0] animate-pulse" />
              Skill · {meta.duration} round
            </div>
            <h2 className="text-xl font-bold text-white">{config.name}</h2>
            <p className="text-xs text-white/70 font-poppins mt-0.5">{config.description}</p>
          </div>
          <div className={`rounded-xl ${meta.iconBg} p-2.5 flex-shrink-0`}>{meta.icon}</div>
        </div>

        <div className="relative z-10 flex flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] text-white/80">
            <Ticket size={11} weight="fill" /> 1 {ticketLabel} entry
          </div>
          <div className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] text-white/80">
            <Ticket size={11} weight="fill" /> {tickets} left
          </div>
          <div className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] text-white/80">
            <Trophy size={11} weight="fill" className="text-yellow-300" />
            Up to <MilesAmount value={config.maxRewardMiles} size={11} variant="alt" />
          </div>
        </div>

        <div className="relative z-10 flex items-center justify-between mb-3">
          {personalBest != null && (
            <p className="text-xs text-white/60 font-poppins">
              Your best: <span className="text-white font-semibold">{personalBest} pts</span>
            </p>
          )}
          <span className="ml-auto text-xs text-white/50">{playsToday}/{dailyCap} today</span>
        </div>

        <button
          type="button"
          onClick={cta.action ?? undefined}
          disabled={!cta.action}
          className={`relative z-10 w-full rounded-xl py-3 text-sm transition-all active:scale-[0.98] ${cta.style}`}
        >
          {cta.label}
        </button>
      </div>
    </div>
  );
}
