"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GameHeader,
  GameIntroSheet,
  GameResultSheet,
  MemoryGrid,
  MemoryStats,
  SubmittingOverlay,
} from "@akiba/skill-games/components";
import { useMemoryFlipGame } from "@akiba/skill-games/client";
import { GAMEPLAY_CONFIGS } from "@akiba/skill-games/core";
import type { GameResult } from "@akiba/skill-games/core";
import { MilesIcon } from "@/components/MilesIcon";
import { track } from "@/lib/analytics/track";
import {
  GamesApiError,
  fetchStatus,
  startSession,
  buildMemoryFlipTransport,
  finishSession,
  type FinishResult,
  type PlayStatus,
} from "@/lib/games/clientTransport";
import { GAME_DAILY_PLAY_CAP, GAME_MAX_REWARD_MILES } from "@/lib/games/gameRewardRules";
import { Brain, Trophy } from "lucide-react";

const config = GAMEPLAY_CONFIGS.memory_flip;

type SettlementStatus = "idle" | "submitting" | "queued" | "settled" | "rejected" | "error";

function toSettlementStatus(finish: FinishResult): SettlementStatus {
  if (!finish.accepted) return "rejected";
  if (finish.reward.mode === "none") return "settled";
  if (finish.reward.status === "failed") return "error";
  if (finish.reward.status === "completed") return "settled";
  return "queued";
}

export default function PassMemoryFlipPage() {
  const [status, setStatus] = useState<PlayStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [introOpen, setIntroOpen] = useState(true);
  const [resultOpen, setResultOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const [settlementStatus, setSettlementStatus] = useState<SettlementStatus>("idle");

  const game = useMemoryFlipGame(sessionId ?? undefined, sessionId ?? undefined, sessionId ? buildMemoryFlipTransport(sessionId) : undefined);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await fetchStatus("memory_flip");
      setStatus(s);
      setStatusError(false);
    } catch {
      setStatusError(true);
    }
  }, []);

  useEffect(() => {
    track("games_home_view", { gameType: "memory_flip" });
    void refreshStatus();
  }, [refreshStatus]);

  const isDailyCapped = status ? status.playsRemaining <= 0 : false;

  async function startRound() {
    if (statusError || isDailyCapped || starting) return;
    setStarting(true);
    setStartError(null);
    track("game_start_requested", { gameType: "memory_flip" });
    try {
      const session = await startSession("memory_flip");
      track("game_start_succeeded", { gameType: "memory_flip" });
      setSessionId(session.sessionId);
      setIntroOpen(false);
      setResultOpen(false);
      setFinishResult(null);
      setSettlementStatus("idle");
      game.reset();
      setTimeout(() => {
        game.begin({ sessionId: session.sessionId, transport: buildMemoryFlipTransport(session.sessionId) });
        track("game_started", { gameType: "memory_flip" });
      }, 50);
    } catch (err) {
      if (err instanceof GamesApiError && err.code === "daily-cap-reached") {
        track("game_start_denied_cap", { gameType: "memory_flip" });
        setStatus((prev) => (prev ? { ...prev, playsRemaining: 0 } : prev));
        setStartError("5/5 played today · Come back tomorrow");
      } else {
        setStartError("Couldn't start the round. Try again.");
      }
      console.error("[pass/memory-flip] start failed", err);
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (game.phase !== "submitting" || !sessionId || settlementStatus === "submitting") return;
    setSettlementStatus("submitting");
    (async () => {
      await game.flushServerFlips?.();
      const result = await finishSession(sessionId);
      track("game_finished", { gameType: "memory_flip", accepted: result.accepted, score: result.score });
      if (!result.accepted) track("game_result_rejected", { gameType: "memory_flip" });
      if (result.reward.deliveryId) track("game_reward_reserved", { gameType: "memory_flip", mode: result.reward.mode });
      setFinishResult(result);
      setSettlementStatus(toSettlementStatus(result));
      if (result.playsRemaining != null) {
        setStatus((prev) => (prev ? { ...prev, playsToday: result.playsToday ?? prev.playsToday, playsRemaining: result.playsRemaining ?? prev.playsRemaining } : prev));
      }
      game.setPhase("settled");
      setResultOpen(true);
    })().catch((err) => {
      console.error("[pass/memory-flip] finish failed", err);
      setSettlementStatus("error");
      game.setPhase("settled");
      setResultOpen(true);
    });
  }, [game, sessionId, settlementStatus]);

  const result: GameResult | null = finishResult
    ? {
        sessionId: finishResult.sessionId,
        gameType: "memory_flip",
        score: finishResult.score,
        mistakes: game.mistakes,
        moves: game.moves,
        matches: game.matches,
        completed: finishResult.completed,
        elapsedMs: finishResult.elapsedMs,
        rewardMiles: finishResult.rewardMiles,
        rewardStable: finishResult.rewardStable,
      }
    : null;

  const isPlaying = game.phase === "playing" || game.phase === "countdown";
  const isDone = game.phase === "settled" || game.phase === "error";
  const playsRemaining = status?.playsRemaining ?? null;
  const capped = playsRemaining != null && playsRemaining <= 0;

  return (
    <main className="min-h-screen pb-28 font-sterling bg-[#F7F4FF]">
      <GameHeader
        title="Memory Flip"
        subtitle="Find all 8 matching pairs before the timer ends."
        gamesHomeHref="/games"
        brandLabel="AkibaMiles"
        milesIcon={<MilesIcon className="h-3.5 w-3.5" />}
      />

      <div className="mt-3 space-y-3">
        {(isPlaying || game.phase === "submitting" || isDone) && (
          <MemoryStats score={game.score} moves={game.moves} matches={game.matches} remainingMs={game.remainingMs} />
        )}

        {sessionId ? (
          <MemoryGrid
            deck={game.deck}
            revealed={game.revealed}
            matched={game.matched}
            onFlip={game.flip}
            disabled={game.phase !== "playing"}
          />
        ) : null}

        <SubmittingOverlay visible={game.phase === "submitting"} label="Checking your score" />

        {game.phase === "countdown" && (
          <div className="mx-4 rounded-2xl bg-gradient-to-br from-[#3B1F6E] to-[#5B35A0] p-10 text-center shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/70 mb-1">Get ready</p>
            <p className="text-7xl font-black text-white">{game.countdown}</p>
          </div>
        )}

        {isDone && !resultOpen && (
          <div className="mx-4">
            <button
              type="button"
              onClick={() => setResultOpen(true)}
              className="w-full rounded-2xl border border-[#5B35A033] bg-white px-5 py-3.5 text-sm font-semibold text-[#5B35A0] flex items-center justify-center gap-2"
            >
              <Trophy size={16} className="text-amber-500" />
              View result
            </button>
          </div>
        )}

        {!sessionId && game.phase === "idle" && (
          <div className="mx-4 space-y-2">
            <div className="rounded-2xl bg-gradient-to-br from-[#3B1F6E] to-[#7B4CC0] p-5 text-center relative overflow-hidden">
              <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
              <div className="relative z-10">
                <Brain size={36} className="mx-auto mb-2 text-purple-200" />
                <p className="text-white font-bold text-lg">Memory Flip</p>
                <p className="text-white/70 text-sm mt-0.5">
                  Free to play · Win up to 12 <MilesIcon className="inline h-3 w-3 align-baseline" />
                </p>
                <div className="mt-2 text-white/50 text-xs">
                  {status ? `${status.playsToday}/${status.dailyCap} played today` : statusError ? "Status unavailable" : "Loading…"}
                </div>

                {statusError ? (
                  <button
                    type="button"
                    onClick={() => void refreshStatus()}
                    className="mt-4 w-full rounded-xl bg-white/20 py-3 text-sm font-bold text-white"
                  >
                    Retry
                  </button>
                ) : capped ? (
                  <div className="mt-4 w-full rounded-xl bg-white/20 py-3 text-sm font-bold text-white/60">
                    5/5 played today · Come back tomorrow
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      track("game_rules_view", { gameType: "memory_flip" });
                      setIntroOpen(true);
                    }}
                    disabled={!status}
                    className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-bold text-[#5B35A0] disabled:opacity-60"
                  >
                    View Rules & Play
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <GameIntroSheet
        open={introOpen}
        onOpenChange={setIntroOpen}
        entryMode="free"
        gameName={config.name}
        gameDescription={config.description}
        shortName={config.shortName}
        maxRewardMiles={GAME_MAX_REWARD_MILES}
        thresholds={config.thresholds}
        milesIcon={<MilesIcon className="h-3 w-3" />}
        dailyPlayCap={GAME_DAILY_PLAY_CAP}
        playsRemaining={status?.playsRemaining}
        loading={starting}
        onPlay={startRound}
        disabled={statusError || isDailyCapped}
        disabledReason={statusError ? "Games are temporarily unavailable. Try again shortly." : isDailyCapped ? "5/5 played today · Come back tomorrow" : undefined}
        error={startError}
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
        settlementStatus={settlementStatus}
        milesIcon={<MilesIcon className="h-4 w-4" />}
        standingsHref="/games?section=leaderboard&gameType=memory_flip"
        onPlayAgain={() => {
          track("game_play_again_tap", { gameType: "memory_flip" });
          setResultOpen(false);
          void startRound();
        }}
        playAgainDisabled={capped}
        playAgainDisabledLabel="5/5 played today"
        track={track}
      />
    </main>
  );
}
