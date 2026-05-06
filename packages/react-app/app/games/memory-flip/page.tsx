"use client";

import { useEffect, useState } from "react";
import { GameHeader } from "@/components/games/game-header";
import { GameIntroSheet } from "@/components/games/game-intro-sheet";
import { GameResultSheet } from "@/components/games/game-result-sheet";
import { LeaderboardCard } from "@/components/games/leaderboard-card";
import { MemoryGrid } from "@/components/games/memory-flip/memory-grid";
import { MemoryStats } from "@/components/games/memory-flip/memory-stats";
import { BuyPlaysSheet } from "@/components/games/buy-plays-sheet";
import { useGameSession } from "@/hooks/games/useGameSession";
import { useMemoryFlipGame } from "@/hooks/games/useMemoryFlipGame";
import { useSettlement } from "@/hooks/games/useSettlement";
import { useCredits } from "@/hooks/games/useCredits";
import { useWeeklyLeaderboard } from "@/hooks/games/useWeeklyLeaderboard";
import { Brain, ArrowCounterClockwise, Trophy, ShoppingCart } from "@phosphor-icons/react";
import { SubmittingOverlay } from "@/components/games/submitting-overlay";
import { MilesAmount } from "@/components/games/miles-amount";

export default function MemoryFlipPage() {
  const [introOpen,    setIntroOpen]    = useState(true);
  const [resultOpen,   setResultOpen]   = useState(false);
  const [buyPlaysOpen, setBuyPlaysOpen] = useState(false);

  const sessionFlow = useGameSession("memory_flip");
  const settlement  = useSettlement("memory_flip");
  const game        = useMemoryFlipGame(sessionFlow.session?.seed, sessionFlow.session?.sessionId);
  const { status: creditStatus, buying, buyError, refresh: refreshCredits, buyCredits } = useCredits("memory_flip", sessionFlow.address);
  const weeklyLb    = useWeeklyLeaderboard("memory_flip");

  const { isDailyCapped, playsToday, credits, hasCredits } = creditStatus;
  const MAX_DAILY = 20;

  async function startRound() {
    settlement.reset();
    const session = await sessionFlow.startSession(creditStatus);
    await refreshCredits();
    setIntroOpen(false);
    setResultOpen(false);
    game.reset();
    setTimeout(() => { if (session) game.begin(); }, 50);
  }

  useEffect(() => {
    if (game.phase !== "submitting" || !game.replay || settlement.status === "submitting") return;
    settlement.submitReplay(game.replay.sessionId, game.replay).then(() => {
      game.setPhase("settled");
      setResultOpen(true);
      refreshCredits();
      weeklyLb.refresh();
    });
  }, [game, settlement, refreshCredits, weeklyLb]);

  const result     = settlement.response?.result ?? null;
  const isPlaying  = game.phase === "playing" || game.phase === "countdown";
  const isDone     = game.phase === "settled" || game.phase === "error";
  const weeklyRank = weeklyLb.myBest?.rank ?? null;

  const startLabel = sessionFlow.isStarting
    ? "Starting round…"
    : `Play again · ${playsToday}/${MAX_DAILY} today`;

  return (
    <main className="min-h-screen pb-28 font-sterling bg-[#F7F4FF]">
      <GameHeader title="Memory Flip" subtitle="Find all 8 matching pairs before the timer ends." />

      <div className="mt-3 space-y-3">
        {/* Stats bar */}
        {(isPlaying || game.phase === "submitting" || isDone) && (
          <MemoryStats score={game.score} moves={game.moves} matches={game.matches} remainingMs={game.remainingMs} />
        )}

        {/* Card grid */}
        <MemoryGrid
          deck={game.deck}
          revealed={game.revealed}
          matched={game.matched}
          onFlip={game.flip}
          disabled={game.phase !== "playing"}
        />

        <SubmittingOverlay visible={game.phase === "submitting"} label="Verifying result" />

        {/* Countdown */}
        {game.phase === "countdown" && (
          <div className="mx-4 rounded-2xl bg-gradient-to-br from-[#3B1F6E] to-[#5B35A0] p-10 text-center shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/70 mb-1">Get ready</p>
            <p className="text-7xl font-black text-white">{game.countdown}</p>
          </div>
        )}

        {/* Post-game CTA */}
        {isDone && !resultOpen && (
          <div className="mx-4 space-y-2">
            <button
              type="button"
              onClick={() => setResultOpen(true)}
              className="w-full rounded-2xl border border-[#5B35A033] bg-white px-5 py-3.5 text-sm font-semibold text-[#5B35A0] flex items-center justify-center gap-2"
            >
              <Trophy size={16} weight="fill" className="text-amber-500" />
              View result
            </button>
            {isDailyCapped ? (
              <div className="w-full rounded-2xl bg-[#F0F0F0] px-5 py-3.5 text-sm font-semibold text-[#888] text-center">
                20/20 played today · Come back tomorrow
              </div>
            ) : (
              <button
                type="button"
                onClick={startRound}
                disabled={sessionFlow.isStarting}
                className="w-full rounded-2xl bg-[#5B35A0] px-5 py-3.5 text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <ArrowCounterClockwise size={16} weight="bold" />
                {startLabel}
              </button>
            )}
          </div>
        )}

        {/* Idle CTA */}
        {game.phase === "idle" && (
          <div className="mx-4 space-y-2">
            <div className="rounded-2xl bg-gradient-to-br from-[#3B1F6E] to-[#7B4CC0] p-5 text-center relative overflow-hidden">
              <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
              <div className="absolute -left-4 -bottom-4 h-16 w-16 rounded-full bg-white/10" />
              <div className="relative z-10">
                <Brain size={36} weight="fill" className="mx-auto mb-2 text-purple-200" />
                <p className="text-white font-bold text-lg">Memory Flip</p>
                <p className="text-white/70 text-sm font-poppins mt-0.5 flex items-center gap-1 justify-center flex-wrap">
                  1 ticket entry · Win up to <MilesAmount value={12} size={13} variant="alt" />
                </p>

                <div className="flex items-center justify-center gap-3 mt-2">
                  {credits > 0 && (
                    <span className="text-xs bg-white/20 text-white rounded-full px-2.5 py-0.5 font-medium">
                      {credits} {credits !== 1 ? "plays" : "play"} left
                    </span>
                  )}
                  <span className="text-white/50 text-xs">{playsToday}/{MAX_DAILY} played today</span>
                </div>

                {isDailyCapped ? (
                  <div className="mt-4 w-full rounded-xl bg-white/20 py-3 text-sm font-bold text-white/60">
                    Come back tomorrow
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIntroOpen(true)}
                    className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-bold text-[#5B35A0]"
                  >
                    {hasCredits ? `Play (${credits} ${credits !== 1 ? "plays" : "play"} left)` : "View Rules & Play"}
                  </button>
                )}
              </div>
            </div>

            {/* Buy plays CTA */}
            <button
              type="button"
              onClick={() => setBuyPlaysOpen(true)}
              className="w-full rounded-2xl border border-[#5B35A0]/20 bg-white px-4 py-3 text-sm font-semibold text-[#5B35A0] flex items-center justify-center gap-2"
            >
              <ShoppingCart size={16} weight="fill" />
              {hasCredits ? `Buy plays (${credits} left)` : "Buy plays — enter instantly"}
            </button>
          </div>
        )}

        {/* Leaderboard */}
        <div className="px-4 pt-2">
          <LeaderboardCard gameType="memory_flip" />
        </div>
      </div>

      <GameIntroSheet
        open={introOpen}
        onOpenChange={setIntroOpen}
        config={sessionFlow.config}
        loading={sessionFlow.isStarting}
        onPlay={startRound}
        disabled={isDailyCapped}
        disabledReason={isDailyCapped ? `20/20 played today · Come back tomorrow` : undefined}
        rules={[
          "Flip two cards at a time and match all 8 pairs.",
          "Cards lock briefly after each flip to keep the game fair.",
          "Score 200+ to earn rewards. Faster and fewer moves scores higher.",
        ]}
      />

      <GameResultSheet
        open={resultOpen}
        onOpenChange={setResultOpen}
        result={result}
        settlementStatus={settlement.status}
        weeklyRank={weeklyRank}
        onPlayAgain={() => {
          setResultOpen(false);
          startRound();
        }}
      />

      <BuyPlaysSheet
        open={buyPlaysOpen}
        onClose={() => setBuyPlaysOpen(false)}
        gameType="memory_flip"
        creditStatus={creditStatus}
        onBuy={buyCredits}
        buying={buying}
        buyError={buyError}
      />
    </main>
  );
}
