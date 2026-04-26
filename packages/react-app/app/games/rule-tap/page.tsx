"use client";

import { useEffect, useState } from "react";
import { GameHeader } from "@/components/games/game-header";
import { GameIntroSheet } from "@/components/games/game-intro-sheet";
import { GameResultSheet } from "@/components/games/game-result-sheet";
import { LeaderboardCard } from "@/components/games/leaderboard-card";
import { RuleBanner } from "@/components/games/rule-tap/rule-banner";
import { RuleTapBoard } from "@/components/games/rule-tap/rule-tap-board";
import { RuleTapScorePanel } from "@/components/games/rule-tap/rule-tap-score-panel";
import { useGameSession } from "@/hooks/games/useGameSession";
import { useRuleTapGame } from "@/hooks/games/useRuleTapGame";
import { useSettlement } from "@/hooks/games/useSettlement";
import { Lightning, ArrowCounterClockwise, Trophy } from "@phosphor-icons/react";
import { MilesAmount } from "@/components/games/miles-amount";
import { SubmittingOverlay } from "@/components/games/submitting-overlay";

export default function RuleTapPage() {
  const [introOpen, setIntroOpen] = useState(true);
  const [resultOpen, setResultOpen] = useState(false);
  const sessionFlow = useGameSession("rule_tap");
  const settlement = useSettlement("rule_tap");
  const game = useRuleTapGame(sessionFlow.session?.seed, sessionFlow.session?.sessionId);

  async function startRound() {
    // Reset settlement state so the effect guard works cleanly for the new round
    settlement.reset();
    const session = await sessionFlow.startSession();
    setIntroOpen(false);
    setResultOpen(false);
    game.reset();
    setTimeout(() => {
      if (session) game.begin();
    }, 50);
  }

  useEffect(() => {
    if (game.phase !== "submitting" || !game.replay || settlement.status === "submitting") return;
    settlement.submitReplay(game.replay.sessionId, game.replay).then(() => {
      game.setPhase("settled");
      setResultOpen(true);
    });
  }, [game, settlement]);

  const result = settlement.response?.result ?? null;
  const isPlaying = game.phase === "playing" || game.phase === "countdown";
  const isDone = game.phase === "settled" || game.phase === "error";

  return (
    <main className="min-h-screen pb-28 font-sterling bg-[#F7FEFF]">
      <GameHeader title="Rule Tap" subtitle="Read the rule, react fast, avoid wrong tiles." />

      <div className="mt-3 space-y-3">
        {/* Score bar */}
        {(isPlaying || game.phase === "submitting" || isDone) && (
          <RuleTapScorePanel
            score={game.score}
            mistakes={game.mistakes}
            remainingMs={game.remainingMs}
            combo={game.combo}
            lastDelta={game.lastDelta}
          />
        )}

        {/* Rule banner */}
        {(isPlaying || game.phase === "submitting") && (
          <RuleBanner rule={game.rule} />
        )}

        {/* The board */}
        <RuleTapBoard
          activeTiles={game.activeTiles}
          feedback={game.feedback}
          onTap={game.tapTile}
          disabled={game.phase !== "playing"}
        />

        {/* Verifying overlay */}
        <SubmittingOverlay visible={game.phase === "submitting"} />

        {/* Countdown overlay */}
        {game.phase === "countdown" && (
          <div className="mx-4 rounded-2xl bg-gradient-to-br from-[#0D7A8A] to-[#238D9D] p-10 text-center shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/70 mb-1">Get ready</p>
            <p className="text-7xl font-black text-white">{game.countdown}</p>
          </div>
        )}

        {/* Post-game CTA — shown when sheet is dismissed or result is available */}
        {isDone && !resultOpen && (
          <div className="mx-4 space-y-2">
            <button
              type="button"
              onClick={() => setResultOpen(true)}
              className="w-full rounded-2xl border border-[#238D9D33] bg-white px-5 py-3.5 text-sm font-semibold text-[#238D9D] flex items-center justify-center gap-2"
            >
              <Trophy size={16} weight="fill" className="text-amber-500" />
              View result
            </button>
            <button
              type="button"
              onClick={startRound}
              disabled={sessionFlow.isStarting}
              className="w-full rounded-2xl bg-[#238D9D] px-5 py-3.5 text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <ArrowCounterClockwise size={16} weight="bold" />
              {sessionFlow.isStarting ? "Starting…" : "Play again"}
            </button>
          </div>
        )}

        {/* Idle state — attractive CTA */}
        {game.phase === "idle" && (
          <div className="mx-4">
            <div className="rounded-2xl bg-gradient-to-br from-[#0D7A8A] to-[#238D9D] p-5 text-center relative overflow-hidden">
              <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
              <div className="absolute -left-4 -bottom-4 h-16 w-16 rounded-full bg-white/10" />
              <div className="relative z-10">
                <Lightning size={36} weight="fill" className="mx-auto mb-2 text-yellow-300" />
                <p className="text-white font-bold text-lg">Rule Tap</p>
                <p className="text-white/70 text-sm font-poppins mt-0.5 flex items-center gap-1 justify-center">
                  <MilesAmount value={5} size={13} variant="alt" /> entry · Up to <MilesAmount value={35} size={13} variant="alt" /> reward
                </p>
                <button
                  type="button"
                  onClick={() => setIntroOpen(true)}
                  className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-bold text-[#238D9D]"
                >
                  View Rules & Play
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Leaderboard */}
        <div className="px-4 pt-2">
          <LeaderboardCard gameType="rule_tap" />
        </div>
      </div>

      <GameIntroSheet
        open={introOpen}
        onOpenChange={setIntroOpen}
        config={sessionFlow.config}
        loading={sessionFlow.isStarting}
        onPlay={startRound}
        rules={[
          "A rule appears above the grid for the full 20-second round.",
          "Tap only tiles matching the rule. Wrong taps reduce your verified score.",
          "The verifier checks your replay log before rewards settle.",
        ]}
      />
      <GameResultSheet
        open={resultOpen}
        onOpenChange={setResultOpen}
        result={result}
        settlementStatus={settlement.status}
        onPlayAgain={() => {
          setResultOpen(false);
          startRound();
        }}
      />
    </main>
  );
}
