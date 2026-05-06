"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LeaderboardCard } from "@/components/games/leaderboard-card";
import { BuyPlaysSheet } from "@/components/games/buy-plays-sheet";
import { GAME_CONFIGS } from "@/lib/games/config";
import { useCredits } from "@/hooks/games/useCredits";
import { useLeaderboard } from "@/hooks/games/useLeaderboard";
import { useWeb3 } from "@/contexts/useWeb3";
import {
  Lightning, Brain, ShoppingCart, Ticket,
  Info, Trophy, Timer, ArrowRight,
  Lightning as LightningFill,
} from "@phosphor-icons/react";
import { MilesAmount } from "@/components/games/miles-amount";
import { GAME_CONFIGS as GC } from "@/lib/games/config";

// How many ms until next UTC midnight reset
function msUntilReset() {
  const now = new Date();
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.getTime() - now.getTime();
}

function useCountdown(targetMs: number) {
  const [timeLeft, setTimeLeft] = useState(targetMs);
  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(prev => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  const h = Math.floor(timeLeft / 3_600_000);
  const m = Math.floor((timeLeft % 3_600_000) / 60_000);
  const s = Math.floor((timeLeft % 60_000) / 1_000);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function GamesPage() {
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

  // Combined ticket count across both games
  const rtTickets = rtCredits.status.credits;
  const mfTickets = mfCredits.status.credits;
  const totalTickets = rtTickets + mfTickets;

  // Use the higher of the two play counts for the shared daily counter
  const playsToday = Math.max(rtCredits.status.playsToday, mfCredits.status.playsToday);
  const MAX_DAILY  = 20;
  const dailyPct   = Math.round((playsToday / MAX_DAILY) * 100);

  function openBuySheet(gameType: "rule_tap" | "memory_flip") {
    setActiveGameType(gameType);
    setBuyPlaysOpen(true);
  }

  const activeCreditStatus = activeGameType === "rule_tap" ? rtCredits.status       : mfCredits.status;
  const activeBuy          = activeGameType === "rule_tap" ? rtCredits.buyCredits   : mfCredits.buyCredits;
  const activeBuying       = activeGameType === "rule_tap" ? rtCredits.buying       : mfCredits.buying;
  const activeBuyError     = activeGameType === "rule_tap" ? rtCredits.buyError     : mfCredits.buyError;

  const personalBests: Record<string, number | null> = {
    rule_tap:    rtLb.myBest?.score   ?? null,
    memory_flip: mfLb.myBest?.score   ?? null,
  };

  return (
    <main className="pb-28 font-sterling min-h-screen bg-[#F5FEFF]">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#0A6B7A] via-[#0D7A8A] to-[#1A9AAD] px-4 pt-10 pb-6">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -left-6 bottom-0 h-28 w-28 rounded-full bg-white/10" />

        <div className="relative z-10">
          {/* Title row */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-white/60 mb-0.5">Spend</p>
              <h1 className="text-2xl font-bold text-white">Skill Games</h1>
              <p className="text-sm text-white/70 font-poppins mt-0.5 flex items-center gap-1">Play short rounds. Win <MilesAmount value="AkibaMiles" size={13} variant="alt" />.</p>
            </div>
            <button
              type="button"
              onClick={() => setInfoOpen(true)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 border border-white/20"
            >
              <Info size={17} className="text-white" />
            </button>
          </div>

          {/* ── Ticket + Daily status card ─────────────────── */}
          <div className="rounded-2xl bg-white/15 border border-white/20 p-4">
            <div className="flex items-start justify-between gap-3">
              {/* Tickets */}
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/20">
                  <Ticket size={22} weight="fill" className="text-white" />
                </div>
                <div>
                  <p className="text-[11px] text-white/60 font-poppins">Tickets available</p>
                  <p className="text-2xl font-bold text-white leading-none mt-0.5">{totalTickets}</p>
                </div>
              </div>

              {/* Divider */}
              <div className="h-12 w-px bg-white/20 self-center" />

              {/* Today */}
              <div className="flex-1">
                <p className="text-[11px] text-white/60 font-poppins">Played today</p>
                <p className="text-2xl font-bold text-white leading-none mt-0.5">{playsToday}<span className="text-sm font-normal text-white/50">/{MAX_DAILY}</span></p>
              </div>

              {/* Reset timer */}
              <div className="text-right">
                <p className="text-[11px] text-white/60 font-poppins flex items-center gap-1 justify-end">
                  <Timer size={11} />
                  Refreshes in
                </p>
                <p className="text-sm font-bold text-white mt-0.5 tabular-nums">{resetCountdown}</p>
              </div>
            </div>

            {/* Daily progress bar */}
            <div className="mt-3">
              <div className="h-1.5 w-full rounded-full bg-white/20">
                <div
                  className="h-1.5 rounded-full bg-[#4EFFA0] transition-all duration-500"
                  style={{ width: `${dailyPct}%` }}
                />
              </div>
            </div>
          </div>

          {/* Buy tickets CTA */}
          <button
            type="button"
            onClick={() => openBuySheet("rule_tap")}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-bold text-[#0D7A8A]"
          >
            <ShoppingCart size={16} weight="fill" />
            Buy tickets
          </button>
        </div>
      </div>

      {/* ── No-tickets nudge ─────────────────────────────── */}
      {address && totalTickets === 0 && playsToday < MAX_DAILY && (
        <div className="mx-4 mt-4 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-4 flex items-start gap-3">
          <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-amber-100">
            <Ticket size={16} weight="fill" className="text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">No tickets left</p>
            <p className="text-xs text-amber-700 font-poppins mt-0.5 flex items-center gap-1 flex-wrap">
              Each round costs 1 ticket (<MilesAmount value={5} size={12} />). Buy tickets to play instantly.
            </p>
            <button
              type="button"
              onClick={() => openBuySheet("rule_tap")}
              className="mt-2.5 rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-bold text-white"
            >
              Buy tickets
            </button>
          </div>
        </div>
      )}

      {/* ── How it works (collapsible) ────────────────────── */}
      {infoOpen && (
        <div className="mx-4 mt-4 rounded-2xl bg-white border border-[#E8F7F9] shadow-sm p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-[#1A1A1A]">How skill games work</p>
            <button
              type="button"
              onClick={() => setInfoOpen(false)}
              className="text-xs text-[#817E7E] font-poppins"
            >
              Close
            </button>
          </div>
          {([
            {
              icon: <Ticket size={15} weight="fill" className="text-[#0D7A8A]" />,
              title: "Buy tickets",
              body: <span className="flex items-center gap-1 flex-wrap">1 ticket = <MilesAmount value={5} size={12} />. Tickets never expire. Max 50 per game.</span>,
            },
            {
              icon: <Lightning size={15} weight="fill" className="text-[#0D7A8A]" />,
              title: "Play instantly",
              body: "Each round uses 1 ticket — no waiting, no extra steps.",
            },
            {
              icon: <Trophy size={15} weight="fill" className="text-amber-500" />,
              title: "Win rewards",
              body: <span className="flex items-center gap-1 flex-wrap">Score above a threshold to earn up to <MilesAmount value={12} size={12} /> per round.</span>,
            },
            {
              icon: <Timer size={15} weight="fill" className="text-[#0D7A8A]" />,
              title: "Daily limit",
              body: "20 rounds per day. Counter resets at midnight UTC.",
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
            tickets={rtTickets}
            playsToday={rtCredits.status.playsToday}
            isDailyCapped={rtCredits.status.isDailyCapped}
            walletConnected={!!address}
            personalBest={personalBests.rule_tap}
            onPlay={() => router.push("/games/rule-tap")}
            onBuyTickets={() => openBuySheet("rule_tap")}
          />
          <GameCard
            gameType="memory_flip"
            tickets={mfTickets}
            playsToday={mfCredits.status.playsToday}
            isDailyCapped={mfCredits.status.isDailyCapped}
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
                    ? "bg-[#0D7A8A] text-white"
                    : "bg-white border border-[#E0E0E0] text-[#525252]",
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

      {/* ── Buy Tickets sheet ─────────────────────────────── */}
      <BuyPlaysSheet
        open={buyPlaysOpen}
        onClose={() => setBuyPlaysOpen(false)}
        gameType={activeGameType}
        creditStatus={activeCreditStatus}
        onBuy={async (count) => {
          await activeBuy(count);
          setBuyPlaysOpen(false);
        }}
        buying={activeBuying}
        buyError={activeBuyError}
      />
    </main>
  );
}

/* ── Rich game card ──────────────────────────────────────── */

const GAME_META = {
  rule_tap: {
    gradient:  "from-[#0A6B7A] via-[#0D7A8A] to-[#1A9AAD]",
    iconBg:    "bg-yellow-400/20",
    icon:      <Lightning size={22} weight="fill" className="text-yellow-300" />,
    accent:    "#0D7A8A",
    duration:  "20s",
  },
  memory_flip: {
    gradient:  "from-[#3B1F6E] via-[#5035A0] to-[#7B4CC0]",
    iconBg:    "bg-purple-300/20",
    icon:      <Brain size={22} weight="fill" className="text-purple-200" />,
    accent:    "#5B35A0",
    duration:  "60s",
  },
} as const;

function GameCard({
  gameType,
  tickets,
  playsToday,
  isDailyCapped,
  walletConnected,
  personalBest,
  onPlay,
  onBuyTickets,
}: {
  gameType:        "rule_tap" | "memory_flip";
  tickets:         number;
  playsToday:      number;
  isDailyCapped:   boolean;
  walletConnected: boolean;
  personalBest:    number | null;
  onPlay:          () => void;
  onBuyTickets:    () => void;
}) {
  const config = GC[gameType];
  const meta   = GAME_META[gameType];
  const MAX    = 20;

  // Button state
  let cta: { label: string; style: string; action: (() => void) | null };
  if (!walletConnected) {
    cta = { label: "Connect wallet", style: "bg-white/20 text-white/60 cursor-not-allowed", action: null };
  } else if (isDailyCapped) {
    cta = { label: "Come back tomorrow", style: "bg-white/20 text-white/60 cursor-not-allowed", action: null };
  } else if (tickets <= 0) {
    cta = { label: "Buy tickets", style: "bg-white/25 border border-white/40 text-white font-bold", action: onBuyTickets };
  } else {
    cta = { label: "Play →", style: "bg-white text-[#0D7A8A] font-bold shadow-sm", action: onPlay };
  }

  return (
    <div className={`rounded-2xl overflow-hidden shadow-md bg-gradient-to-br ${meta.gradient}`}>
      {/* Main area */}
      <div className="px-4 pt-4 pb-3 relative">
        {/* Decorative blobs */}
        <div className="pointer-events-none absolute -right-5 -top-5 h-24 w-24 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute right-14 bottom-0 h-10 w-10 rounded-full bg-white/10" />

        {/* Title row */}
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

        {/* Stats pills row */}
        <div className="relative z-10 flex flex-wrap gap-2 mb-3">
          <div className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] text-white/80">
            <Ticket size={11} weight="fill" />
            1 ticket entry
          </div>
          <div className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] text-white/80">
            <Trophy size={11} weight="fill" className="text-yellow-300" />
            Up to <MilesAmount value={config.maxRewardMiles} size={11} variant="alt" />
          </div>
          {config.weeklyPrizeUsd > 0 && (
            <div className="flex items-center gap-1 rounded-full bg-yellow-400/20 px-2.5 py-1 text-[11px] text-yellow-200">
              🏆 Weekly top 3 share ${config.weeklyPrizeUsd}
            </div>
          )}
        </div>

        {/* Personal best + tickets left */}
        <div className="relative z-10 flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {personalBest != null && (
              <p className="text-xs text-white/60 font-poppins">
                Your best: <span className="text-white font-semibold">{personalBest} pts</span>
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {tickets > 0 ? (
              <span className="text-xs bg-white/20 text-white rounded-full px-2.5 py-0.5 font-medium">
                {tickets} ticket{tickets !== 1 ? "s" : ""} left
              </span>
            ) : (
              <span className="text-xs bg-white/10 text-white/50 rounded-full px-2.5 py-0.5 font-medium">
                No tickets
              </span>
            )}
            <span className="text-xs text-white/50">
              {playsToday}/{MAX} today
            </span>
          </div>
        </div>

        {/* CTA button */}
        <button
          type="button"
          onClick={cta.action ?? undefined}
          disabled={!cta.action}
          className={`relative z-10 w-full rounded-xl py-3 text-sm transition-all active:scale-[0.98] ${cta.style}`}
        >
          {cta.label}
        </button>
      </div>

      {/* Reward threshold bar */}
      <div className="bg-black/20 px-4 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-[10px] text-white/50 font-poppins mr-1">Rewards:</span>
        {config.thresholds.map((t) => (
          <span
            key={t.label}
            className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/70"
          >
            {t.minScore}+ pts → <MilesAmount value={t.miles} size={10} variant="alt" />
          </span>
        ))}
      </div>
    </div>
  );
}
