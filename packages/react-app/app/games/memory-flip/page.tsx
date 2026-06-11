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
import { MilesAmount } from "@/components/games/miles-amount";
import { rewardForScore } from "@/lib/games/score";
import type { GameResult } from "@/lib/games/types";

export default function MemoryFlipPage() {
  const [introOpen,    setIntroOpen]    = useState(true);
  const [resultOpen,   setResultOpen]   = useState(false);
  const [buyPlaysOpen, setBuyPlaysOpen] = useState(false);
  const [localResult,  setLocalResult]  = useState<GameResult | null>(null);

  const sessionFlow = useGameSession("memory_flip");
  const settlement  = useSettlement("memory_flip");
  const game        = useMemoryFlipGame(sessionFlow.session?.sessionId, sessionFlow.address, sessionFlow.session?.seed);
  const { status: creditStatus, buying, buyError, refresh: refreshCredits, buyCredits } = useCredits("memory_flip", sessionFlow.address);
  const weeklyLb    = useWeeklyLeaderboard("memory_flip");

  const { isDailyCapped, playsToday, credits, hasCredits } = creditStatus;
  const MAX_DAILY = creditStatus.dailyCap;

  async function startRound() {
    settlement.reset();
    setLocalResult(null);
    try {
      const session = await sessionFlow.startSession(creditStatus);
      setIntroOpen(false);
      setResultOpen(false);
      game.reset();
      // Pass the freshly created session in so init() uses THIS round's id/wallet,
      // not a stale closure from before startSession() resolved.
      setTimeout(() => {
        if (session) game.begin({ sessionId: session.sessionId, walletAddress: session.walletAddress });
      }, 50);
      void refreshCredits();
    } catch (err) {
      console.error("[memory-flip] start failed", err);
      setIntroOpen(true);
      setResultOpen(false);
    }
  }

  useEffect(() => {
    if (game.phase !== "submitting" || settlement.status === "submitting") return;
    const sessionId = sessionFlow.session?.sessionId;
    // Use the session's own wallet so finish matches the wallet init persisted.
    const wallet = sessionFlow.session?.walletAddress ?? sessionFlow.address;
    // Provisional result shown immediately; the authoritative result (server-auth
    // mode) replaces it once /session/finish responds.
    const { rewardMiles, rewardStable } = rewardForScore("memory_flip", game.score);
    setLocalResult({
      sessionId:   sessionId ?? "",
      gameType:    "memory_flip",
      score:       game.score,
      mistakes:    game.mistakes,
      moves:       game.moves,
      matches:     game.matches,
      completed:   game.matches === 8,
      elapsedMs:   game.elapsedMs,
      rewardMiles,
      rewardStable,
    });
    game.setPhase("settled");
    setResultOpen(true);

    const onSettled = () => {
      refreshCredits();
      weeklyLb.refresh();
    };
    if (game.serverMode && sessionId && wallet) {
      // Make sure every mirrored flip has reached the server before it scores.
      (async () => {
        await game.flushServerFlips?.();
        await settlement.submitFinish(sessionId, wallet);
        onSettled();
      })().catch((err) => {
        console.error("[memory-flip] finish failed", err);
      });
    } else if (game.replay) {
      settlement.submitReplay(game.replay.sessionId, game.replay).then(onSettled).catch((err) => {
        console.error("[memory-flip] settlement failed", err);
      });
    }
  }, [game, settlement, refreshCredits, weeklyLb, sessionFlow]);

  const result     = settlement.response?.result ?? localResult;
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
                {MAX_DAILY}/{MAX_DAILY} played today · Come back tomorrow
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
                  1 Memory ticket · Win up to <MilesAmount value={12} size={13} variant="alt" />
                </p>

                <div className="flex items-center justify-center gap-3 mt-2">
                  {credits > 0 && (
                    <span className="text-xs bg-white/20 text-white rounded-full px-2.5 py-0.5 font-medium">
                      {credits} Memory {credits !== 1 ? "tickets" : "ticket"} left
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
                    {hasCredits ? `Play (${credits} Memory ${credits !== 1 ? "tickets" : "ticket"} left)` : "View Rules & Play"}
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
              {hasCredits ? `Buy Memory tickets (${credits} left)` : "Buy Memory tickets"}
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
        disabledReason={isDailyCapped ? `${MAX_DAILY}/${MAX_DAILY} played today · Come back tomorrow` : undefined}
        error={sessionFlow.error}
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
