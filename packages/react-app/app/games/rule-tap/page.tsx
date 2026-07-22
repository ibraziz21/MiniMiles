"use client";

import { useEffect, useState } from "react";
import { GameHeader } from "@/components/games/game-header";
import { GameIntroSheet } from "@/components/games/game-intro-sheet";
import { GameResultSheet } from "@/components/games/game-result-sheet";
import { LeaderboardCard } from "@/components/games/leaderboard-card";
import { RuleBanner } from "@/components/games/rule-tap/rule-banner";
import { RuleTapBoard } from "@/components/games/rule-tap/rule-tap-board";
import { RuleTapScorePanel } from "@/components/games/rule-tap/rule-tap-score-panel";
import { BuyPlaysSheet } from "@/components/games/buy-plays-sheet";
import { useGameSession } from "@/hooks/games/useGameSession";
import { useRuleTapGame } from "@/hooks/games/useRuleTapGame";
import { useSettlement } from "@/hooks/games/useSettlement";
import { useCredits } from "@/hooks/games/useCredits";
import { useWeeklyLeaderboard } from "@/hooks/games/useWeeklyLeaderboard";
import { useWeeklyCampaign } from "@/hooks/games/useWeeklyCampaign";
import { Lightning, ArrowCounterClockwise, Trophy, ShoppingCart } from "@phosphor-icons/react";
import { MilesAmount } from "@/components/games/miles-amount";
import { rewardForScore } from "@/lib/games/score";
import { AKIBA_SKILL_GAMES_ADDRESS } from "@/lib/games/contracts";
import type { GameResult } from "@/lib/games/types";

export default function RuleTapPage() {
  const [introOpen,      setIntroOpen]      = useState(true);
  const [resultOpen,     setResultOpen]     = useState(false);
  const [buyPlaysOpen,   setBuyPlaysOpen]   = useState(false);
  const [localResult,    setLocalResult]    = useState<GameResult | null>(null);

  const sessionFlow = useGameSession("rule_tap");
  const settlement  = useSettlement("rule_tap");
  const game        = useRuleTapGame(sessionFlow.session?.sessionId, sessionFlow.address, sessionFlow.session?.seed);
  const { status: creditStatus, buying, buyError, refresh: refreshCredits, buyCredits } = useCredits("rule_tap", sessionFlow.address);
  const weeklyLb    = useWeeklyLeaderboard("rule_tap");
  const { campaign } = useWeeklyCampaign();

  const { isDailyCapped, playsToday, credits, hasCredits } = creditStatus;
  const MAX_DAILY = creditStatus.dailyCap;
  const serviceUnavailable = Boolean(AKIBA_SKILL_GAMES_ADDRESS) && creditStatus.backendDegraded;
  // A ticket is required when the contract is live; force a purchase when out.
  const mustBuy = creditStatus.contractAvailable && !hasCredits;

  async function startRound() {
    if (serviceUnavailable) {
      setIntroOpen(true);
      setResultOpen(false);
      return;
    }
    // No ticket → cannot play. Send the player to buy tickets instead.
    if (mustBuy) {
      setIntroOpen(false);
      setBuyPlaysOpen(true);
      return;
    }
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
      console.error("[rule-tap] start failed", err);
      setIntroOpen(true);
      setResultOpen(false);
    }
  }

  useEffect(() => {
    if (game.phase !== "submitting" || settlement.status === "submitting") return;
    const sessionId = sessionFlow.session?.sessionId;
    // Use the session's own wallet so finish matches the wallet init persisted.
    const wallet = sessionFlow.session?.walletAddress ?? sessionFlow.address;
    const { rewardMiles, rewardStable } = rewardForScore("rule_tap", game.score);
    setLocalResult({
      sessionId:   sessionId ?? "",
      gameType:    "rule_tap",
      score:       game.score,
      mistakes:    game.mistakes,
      completed:   game.elapsedMs >= 18_000,
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
      settlement.submitFinish(sessionId, wallet).then(onSettled).catch((err) => {
        console.error("[rule-tap] finish failed", err);
      });
    } else if (game.replay) {
      settlement.submitReplay(game.replay.sessionId, game.replay).then(onSettled).catch((err) => {
        console.error("[rule-tap] settlement failed", err);
      });
    }
  }, [game, settlement, refreshCredits, weeklyLb, sessionFlow]);

  const result       = settlement.response?.result ?? localResult;
  const isPlaying    = game.phase === "playing" || game.phase === "countdown";
  const isDone       = game.phase === "settled" || game.phase === "error";
  const weeklyRank   = weeklyLb.myBest?.rank ?? null;
  const rank3Label   = campaign?.tiers.find((t) => t.rank === 3)?.label ?? null;

  const startLabel = sessionFlow.isStarting
    ? "Starting round…"
    : `Play again · ${playsToday}/${MAX_DAILY} today`;

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

        {/* Countdown */}
        {game.phase === "countdown" && (
          <div className="mx-4 rounded-2xl bg-gradient-to-br from-[#0D7A8A] to-[#238D9D] p-10 text-center shadow-lg">
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
              className="w-full rounded-2xl border border-[#238D9D33] bg-white px-5 py-3.5 text-sm font-semibold text-[#238D9D] flex items-center justify-center gap-2"
            >
              <Trophy size={16} weight="fill" className="text-amber-500" />
              View result
            </button>
            {isDailyCapped ? (
              <div className="rounded-2xl bg-[#F0F0F0] px-5 py-3.5 text-sm font-semibold text-[#888] text-center">
                {MAX_DAILY}/{MAX_DAILY} played today · Come back tomorrow
              </div>
            ) : (
              <button
                type="button"
                onClick={startRound}
                disabled={sessionFlow.isStarting}
                className="w-full rounded-2xl bg-[#238D9D] px-5 py-3.5 text-sm font-bold text-white flex items-center justify-center gap-2 disabled:opacity-60"
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
            <div className="rounded-2xl bg-gradient-to-br from-[#0D7A8A] to-[#238D9D] p-5 text-center relative overflow-hidden">
              <div className="absolute -right-4 -top-4 h-20 w-20 rounded-full bg-white/10" />
              <div className="absolute -left-4 -bottom-4 h-16 w-16 rounded-full bg-white/10" />
              <div className="relative z-10">
                <Lightning size={36} weight="fill" className="mx-auto mb-2 text-yellow-300" />
                <p className="text-white font-bold text-lg">Rule Tap</p>
                <p className="text-white/70 text-sm font-poppins mt-0.5 flex items-center gap-1 justify-center flex-wrap">
                  {hasCredits
                    ? <>1 ticket · Win up to <MilesAmount value={12} size={13} variant="alt" /></>
                    : <>1 ticket per round · Win up to <MilesAmount value={12} size={13} variant="alt" /></>}
                </p>

                <div className="flex items-center justify-center gap-3 mt-2">
                  {credits > 0 && (
                    <span className="text-xs bg-white/20 text-white rounded-full px-2.5 py-0.5 font-medium">
                      {credits} Rule Tap {credits !== 1 ? "tickets" : "ticket"} left
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
                    onClick={() => (mustBuy ? setBuyPlaysOpen(true) : setIntroOpen(true))}
                    className="mt-4 w-full rounded-xl bg-white py-3 text-sm font-bold text-[#238D9D] flex items-center justify-center gap-1.5"
                  >
                    {hasCredits
                      ? `Play · ${credits} ${credits !== 1 ? "tickets" : "ticket"} left`
                      : mustBuy
                      ? "Buy tickets to play"
                      : "View Rules & Play"}
                  </button>
                )}
              </div>
            </div>

            {/* Buy plays CTA */}
            <button
              type="button"
              onClick={() => setBuyPlaysOpen(true)}
              className="w-full rounded-2xl border border-[#0D7A8A]/20 bg-white px-4 py-3 text-sm font-semibold text-[#0D7A8A] flex items-center justify-center gap-2"
            >
              <ShoppingCart size={16} weight="fill" />
              {hasCredits ? `Buy Rule Tap tickets (${credits} left)` : "Buy Rule Tap tickets"}
            </button>
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
        credits={credits}
        mustBuy={mustBuy}
        onBuyTickets={() => { setIntroOpen(false); setBuyPlaysOpen(true); }}
        disabled={isDailyCapped || serviceUnavailable}
        disabledReason={
          serviceUnavailable
            ? creditStatus.statusError ?? "Skill Games service is temporarily unavailable. Please try again shortly."
            : isDailyCapped
              ? `${MAX_DAILY}/${MAX_DAILY} played today · Come back tomorrow`
              : undefined
        }
        error={sessionFlow.error ?? creditStatus.statusError}
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
        settlementStatus={settlement.status}
        weeklyRank={weeklyRank}
        weeklyEntries={weeklyLb.entries}
        rank3Label={rank3Label}
        onPlayAgain={() => {
          setResultOpen(false);
          startRound();
        }}
      />

      <BuyPlaysSheet
        open={buyPlaysOpen}
        onClose={() => setBuyPlaysOpen(false)}
        gameType="rule_tap"
        creditStatus={creditStatus}
        onBuy={buyCredits}
        buying={buying}
        buyError={buyError}
      />
    </main>
  );
}
