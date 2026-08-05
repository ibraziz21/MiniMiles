"use client";

import { useCallback, useEffect, useState } from "react";
import {
  GameHeader,
  GameIntroSheet,
  GameResultSheet,
  RuleBanner,
  RuleTapBoard,
  RuleTapScorePanel,
  SubmittingOverlay,
} from "@akiba/skill-games/components";
import { useRuleTapGame } from "@akiba/skill-games/client";
import { GAMEPLAY_CONFIGS } from "@akiba/skill-games/core";
import type { GameResult } from "@akiba/skill-games/core";
import { MilesIcon } from "@/components/MilesIcon";
import { track } from "@/lib/analytics/track";
import {
  GamesApiError,
  fetchStatus,
  startSession,
  buildRuleTapTransport,
  finishSession,
  type FinishResult,
  type PlayStatus,
} from "@/lib/games/clientTransport";
import { Zap, Trophy } from "lucide-react";

const config = GAMEPLAY_CONFIGS.rule_tap;

type SettlementStatus = "idle" | "submitting" | "queued" | "settled" | "rejected" | "error";

function toSettlementStatus(finish: FinishResult): SettlementStatus {
  if (!finish.accepted) return "rejected";
  if (finish.reward.mode === "none") return "settled";
  if (finish.reward.status === "failed") return "error";
  if (finish.reward.status === "completed") return "settled";
  return "queued";
}

export default function PassRuleTapPage() {
  const [status, setStatus] = useState<PlayStatus | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [introOpen, setIntroOpen] = useState(true);
  const [resultOpen, setResultOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [finishResult, setFinishResult] = useState<FinishResult | null>(null);
  const [settlementStatus, setSettlementStatus] = useState<SettlementStatus>("idle");

  const game = useRuleTapGame(sessionId ?? undefined, sessionId ?? undefined, sessionId ? buildRuleTapTransport(sessionId) : undefined);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await fetchStatus("rule_tap");
      setStatus(s);
      setStatusError(false);
    } catch {
      setStatusError(true);
    }
  }, []);

  useEffect(() => {
    track("games_home_view", { gameType: "rule_tap" });
    void refreshStatus();
  }, [refreshStatus]);

  const isDailyCapped = status ? status.playsRemaining <= 0 : false;

  async function startRound() {
    if (statusError || isDailyCapped || starting) return;
    setStarting(true);
    setStartError(null);
    track("game_start_requested", { gameType: "rule_tap" });
    try {
      const session = await startSession("rule_tap");
      track("game_start_succeeded", { gameType: "rule_tap" });
      setSessionId(session.sessionId);
      setIntroOpen(false);
      setResultOpen(false);
      setFinishResult(null);
      setSettlementStatus("idle");
      game.reset();
      setTimeout(() => {
        game.begin({ sessionId: session.sessionId, transport: buildRuleTapTransport(session.sessionId) });
        track("game_started", { gameType: "rule_tap" });
      }, 50);
    } catch (err) {
      if (err instanceof GamesApiError && err.code === "daily-cap-reached") {
        track("game_start_denied_cap", { gameType: "rule_tap" });
        setStatus((prev) => (prev ? { ...prev, playsRemaining: 0 } : prev));
        setStartError("5/5 played today · Come back tomorrow");
      } else {
        setStartError("Couldn't start the round. Try again.");
      }
      console.error("[pass/rule-tap] start failed", err);
    } finally {
      setStarting(false);
    }
  }

  useEffect(() => {
    if (game.phase !== "submitting" || !sessionId || settlementStatus === "submitting") return;
    setSettlementStatus("submitting");
    finishSession(sessionId)
      .then((result) => {
        track("game_finished", { gameType: "rule_tap", accepted: result.accepted, score: result.score });
        if (!result.accepted) track("game_result_rejected", { gameType: "rule_tap" });
        if (result.reward.deliveryId) track("game_reward_reserved", { gameType: "rule_tap", mode: result.reward.mode });
        setFinishResult(result);
        setSettlementStatus(toSettlementStatus(result));
        if (result.playsRemaining != null) {
          setStatus((prev) => (prev ? { ...prev, playsToday: result.playsToday ?? prev.playsToday, playsRemaining: result.playsRemaining ?? prev.playsRemaining } : prev));
        }
        game.setPhase("settled");
        setResultOpen(true);
      })
      .catch((err) => {
        console.error("[pass/rule-tap] finish failed", err);
        setSettlementStatus("error");
        game.setPhase("settled");
        setResultOpen(true);
      });
  }, [game, sessionId, settlementStatus]);

  const result: GameResult | null = finishResult
    ? {
        sessionId: finishResult.sessionId,
        gameType: "rule_tap",
        score: finishResult.score,
        mistakes: game.mistakes,
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
    <main className="min-h-screen pb-28 font-sterling bg-[#F7FEFF]">
      <GameHeader
        title="Rule Tap"
        subtitle="Read the rule, react fast, avoid wrong tiles."
        gamesHomeHref="/games"
        brandLabel="AkibaMiles"
        milesIcon={<MilesIcon className="h-3.5 w-3.5" />}
      />

      <div className="mt-3 space-y-3">
        {(isPlaying || game.phase === "submitting" || isDone) && (
          <RuleTapScorePanel
            score={game.score}
            mistakes={game.mistakes}
            remainingMs={game.remainingMs}
            combo={game.combo}
            lastDelta={game.lastDelta}
          />
        )}

        {(isPlaying || game.phase === "submitting") && <RuleBanner rule={game.rule} />}

        {sessionId ? (
          <RuleTapBoard
            activeTiles={game.activeTiles}
            feedback={game.feedback}
            onTap={game.tapTile}
            disabled={game.phase !== "playing"}
          />
        ) : null}

        <SubmittingOverlay visible={game.phase === "submitting"} label="Checking your score" />

        {game.phase === "countdown" && (
          <div className="mx-4 rounded-2xl bg-gradient-to-br from-[#0D7A8A] to-[#238D9D] p-10 text-center shadow-lg">
            <p className="text-xs font-semibold uppercase tracking-widest text-white/70 mb-1">Get ready</p>
            <p className="text-7xl font-black text-white">{game.countdown}</p>
          </div>
        )}

        {isDone && !resultOpen && (
          <div className="mx-4">
            <button
              type="button"
              onClick={() => setResultOpen(true)}
              className="w-full rounded-2xl border border-[#238D9D33] bg-white px-5 py-3.5 text-sm font-semibold text-[#238D9D] flex items-center justify-center gap-2"
            >
              <Trophy size={16} className="text-amber-500" />
              View result
            </button>
          </div>
        )}

        {!sessionId && game.phase === "idle" && (
          <div className="mx-4 space-y-2">
            <div className="rounded-2xl bg-gradient-to-br from-[#0D7A8A] to-[#238D9D] p-5 text-center relative overflow-hidden">
              <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
              <div className="relative z-10">
                <Zap size={36} className="mx-auto mb-2 text-yellow-300" />
                <p className="text-white font-bold text-lg">Rule Tap</p>
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
                      track("game_rules_view", { gameType: "rule_tap" });
                      setIntroOpen(true);
                    }}
                    disabled={!status}
                    className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-bold text-[#238D9D] disabled:opacity-60"
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
        maxRewardMiles={12}
        thresholds={config.thresholds}
        milesIcon={<MilesIcon className="h-3 w-3" />}
        dailyPlayCap={5}
        playsRemaining={status?.playsRemaining}
        loading={starting}
        onPlay={startRound}
        disabled={statusError || isDailyCapped}
        disabledReason={statusError ? "Games are temporarily unavailable. Try again shortly." : isDailyCapped ? "5/5 played today · Come back tomorrow" : undefined}
        error={startError}
        rules={[
          "A rule appears above the grid for the full 20-second round.",
          "Tap only tiles matching the rule. Wrong taps reduce your score.",
          "Score 10+ to earn rewards. Higher score = higher reward.",
        ]}
      />

      <GameResultSheet
        open={resultOpen}
        onOpenChange={setResultOpen}
        result={result}
        settlementStatus={settlementStatus}
        milesIcon={<MilesIcon className="h-4 w-4" />}
        standingsHref="/games"
        onPlayAgain={() => {
          track("game_play_again_tap", { gameType: "rule_tap" });
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
