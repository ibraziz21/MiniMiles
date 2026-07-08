"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWeb3 } from "@/contexts/useWeb3";
import {
  type CycleView,
  type AttemptView,
  type GuessView,
  type CrackPotVersion,
  ENTRY_FEE_USDT,
  FREE_ATTEMPTS_PER_CYCLE,
} from "@/lib/crackpotTypes";
import { CrackPotHeader }        from "./CrackPotHeader";
import { PotDisplay }            from "./PotDisplay";
import { GuessBoard }            from "./GuessBoard";
import { GuessFeedback }         from "./GuessFeedback";
import { AttemptTimer }          from "./AttemptTimer";
import { AttemptExpiredModal }   from "./AttemptExpiredModal";
import { WinScreen }             from "./WinScreen";
import { DeathScreen }           from "./DeathScreen";
import { LiveFeed }              from "./LiveFeed";
import { TutorialOverlay, useTutorialSeen } from "./TutorialOverlay";
import { CrackPotWinnerToast }       from "./CrackPotWinnerToast";

type Phase =
  | "loading"
  | "browsing"
  | "starting"
  | "playing"
  | "attempt_expired"
  | "won"
  | "exhausted"
  | "cycle_cracked"
  | "error";

type PlayVersion = Extract<CrackPotVersion, "miles" | "usdt">;
type StartStep = "idle" | "auth" | "syncing" | "approving" | "entering" | "opening";
type GuessResponse = {
  guessView?: GuessView;
  isCorrect?: boolean;
  newStatus?: AttemptView["status"];
  guessNumber?: number;
  feedbackIsNoiseless?: boolean;
  error?: string;
  message?: string;
  status?: string;
};

async function fetchCycle(version: PlayVersion): Promise<CycleView> {
  const res = await fetch(`/api/crackpot/cycle/current?version=${version}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`cycle API ${res.status}`);
  return res.json();
}

function startStepLabel(step: StartStep, version: PlayVersion, hasPendingTx: boolean): string {
  if (step === "auth") return "Checking session...";
  if (step === "syncing") return "Checking live cycle...";
  if (step === "approving") return `Approving $${ENTRY_FEE_USDT.toFixed(2)} USDT...`;
  if (step === "entering") return "Entering on-chain...";
  if (step === "opening") return hasPendingTx && version === "usdt" ? "Recovering paid attempt..." : "Opening attempt...";
  return version === "usdt"
    ? hasPendingTx
      ? "Recover Paid Attempt"
      : `Approve + Enter - $${ENTRY_FEE_USDT.toFixed(2)}`
    : `Start Attempt - ${FREE_ATTEMPTS_PER_CYCLE} Free`;
}

function shuffleOrder(): number[] {
  const arr = [0, 1, 2, 3, 4, 5];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function CrackPotGamePage() {
  const router = useRouter();
  const {
    address,
    waitForAuth,
    approveUsdtForCrackPot,
    enterCrackPotGame,
  } = useWeb3() as {
    address: string | null;
    waitForAuth: (timeoutMs?: number) => Promise<void>;
    approveUsdtForCrackPot: (amountUsd: number) => Promise<string>;
    enterCrackPotGame: (version: 0 | 1) => Promise<string>;
  };

  const [version, setVersion]     = useState<PlayVersion>("miles");
  const [phase, setPhase]       = useState<Phase>("loading");
  const [cycle, setCycle]       = useState<CycleView | null>(null);
  const [attempt, setAttempt]   = useState<AttemptView | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [startStep, setStartStep] = useState<StartStep>("idle");
  const [pendingUsdtTxHash, setPendingUsdtTxHash] = useState<string | null>(null);
  const [cooldown, setCooldown]   = useState(0);
  const [symbolOrder]             = useState<number[]>(shuffleOrder);
  const [showTutorial, setShowTutorial] = useState(false);
  const [winnerToastInfo, setWinnerToastInfo] = useState<{ address: string; guesses: number; potBalance: number } | null>(null);

  const [tutorialSeen, markTutorialSeen] = useTutorialSeen(address);

  // Expire timer ref — fires when the active attempt's 60s window closes
  const expireTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load cycle ───────────────────────────────────────────────────────────
  const loadCycle = useCallback(async () => {
    try {
      const data = await fetchCycle(version);
      setCycle(data);
      if (data.status === "cracked" || data.status === "dead" || data.status === "settling") {
        setPhase("cycle_cracked");
      } else {
        setPhase((prev) => prev === "loading" ? "browsing" : prev);
      }
    } catch (e: any) {
      setErrorMsg(e.message ?? "Failed to load cycle");
      setPhase("error");
    }
  }, [version]);

  useEffect(() => {
    loadCycle();
    // Re-poll cycle every 30s to catch rotation
    const id = setInterval(loadCycle, 30_000);
    return () => clearInterval(id);
  }, [loadCycle]);

  useEffect(() => {
    if (expireTimerRef.current) clearTimeout(expireTimerRef.current);
    setPhase("loading");
    setCycle(null);
    setAttempt(null);
    setErrorMsg(null);
    setCooldown(0);
    setStartStep("idle");
  }, [version]);

  // ── Attempt expire timer ─────────────────────────────────────────────────
  function scheduleExpireTimer(expiresAt: string) {
    if (expireTimerRef.current) clearTimeout(expireTimerRef.current);
    const msLeft = new Date(expiresAt).getTime() - Date.now();
    if (msLeft > 0) {
      expireTimerRef.current = setTimeout(() => {
        setPhase((prev) => prev === "playing" ? "attempt_expired" : prev);
      }, msLeft + 500); // 500ms grace
    } else {
      setPhase((prev) => prev === "playing" ? "attempt_expired" : prev);
    }
  }

  useEffect(() => () => { if (expireTimerRef.current) clearTimeout(expireTimerRef.current); }, []);

  // ── Cooldown ticker ──────────────────────────────────────────────────────
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(id);
  }, [cooldown]);

  // ── Start attempt ────────────────────────────────────────────────────────
  async function startAttempt() {
    if (!address) {
      setErrorMsg("Connect your wallet to play");
      return;
    }
    setPhase("starting");
    setErrorMsg(null);
    try {
      setStartStep("auth");
      await waitForAuth();
      const sessionRes = await fetch("/api/auth/session", { cache: "no-store" });
      const session = await sessionRes.json().catch(() => ({}));
      if (!sessionRes.ok || !session.authenticated || session.walletAddress !== address.toLowerCase()) {
        throw new Error("Sign in to play");
      }

      setStartStep("syncing");
      const freshCycle = await fetchCycle(version);
      setCycle(freshCycle);
      if (freshCycle.status !== "active") {
        setPhase("cycle_cracked");
        setStartStep("idle");
        return;
      }

      let txHash = pendingUsdtTxHash;
      if (version === "usdt" && !txHash) {
        setStartStep("approving");
        await approveUsdtForCrackPot(ENTRY_FEE_USDT);
        setStartStep("entering");
        txHash = await enterCrackPotGame(1);
        setPendingUsdtTxHash(txHash);
      }

      setStartStep("opening");
      const res = await fetch("/api/crackpot/attempt/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, txHash: version === "usdt" ? txHash : undefined }),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        setErrorMsg("Sign in to play");
        setPhase("browsing");
        setStartStep("idle");
        return;
      }
      if (res.status === 402) {
        setPhase("exhausted");
        setStartStep("idle");
        return;
      }
      if (!res.ok) {
        setErrorMsg(data.message ?? data.error ?? "Failed to start attempt");
        setPhase("browsing");
        setStartStep("idle");
        return;
      }

      const attemptView: AttemptView = data;
      setAttempt(attemptView);
      if (version === "usdt") setPendingUsdtTxHash(null);

      // If this attempt already has a correct guess (page refresh after win)
      if (attemptView.status === "won") {
        setPhase("won");
        setStartStep("idle");
        return;
      }

      if (attemptView.status !== "active") {
        // expired or lost
        setPhase("attempt_expired");
        setStartStep("idle");
        return;
      }

      if (!tutorialSeen) {
        setShowTutorial(true);
      }

      setPhase("playing");
      setStartStep("idle");
      scheduleExpireTimer(attemptView.expiresAt);

      // If there are existing guesses, start the cooldown from the last guess
      if (attemptView.guesses.length > 0) {
        const lastGuessAt = new Date(attemptView.guesses[attemptView.guesses.length - 1].createdAt).getTime();
        const elapsed = Math.floor((Date.now() - lastGuessAt) / 1000);
        const remaining = Math.max(0, 15 - elapsed);
        setCooldown(remaining);
      }
    } catch (e: any) {
      setErrorMsg(e.message ?? "Network error");
      setPhase("browsing");
      setStartStep("idle");
    }
  }

  // ── Submit guess ─────────────────────────────────────────────────────────
  async function submitGuess(symbols: [number, number, number, number]) {
    if (!attempt || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/crackpot/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attemptId: attempt.attemptId, symbols }),
      });
      const data: GuessResponse = await res.json().catch(() => ({}));

      if (res.status === 410 || (res.status === 409 && data.status === "expired")) {
        setPhase("attempt_expired");
        return;
      }
      if (!res.ok) {
        setErrorMsg(data.message ?? data.error ?? "Failed to submit guess");
        return;
      }
      if (!data.guessView) {
        setErrorMsg("Failed to read guess result");
        return;
      }

      // Update attempt locally with the new guess
      setAttempt((prev) => {
        if (!prev) return prev;
        const updatedGuesses = [...prev.guesses, data.guessView!];
        const newAttempt: AttemptView = {
          ...prev,
          guesses: updatedGuesses,
          guessesUsed: updatedGuesses.length,
          status: data.newStatus ?? (data.isCorrect ? "won" : prev.status),
        };
        return newAttempt;
      });

      if (data.isCorrect) {
        setPhase("won");
      } else if (data.newStatus === "lost") {
        setPhase("attempt_expired");
      } else {
        setCooldown(15);
      }
    } catch {
      setErrorMsg("Network error");
    } finally {
      setIsSubmitting(false);
    }
  }

  // ── Try again after expiry ───────────────────────────────────────────────
  async function tryAgain() {
    setAttempt(null);
    setCooldown(0);
    await startAttempt();
  }

  // ── Winner detected via LiveFeed ─────────────────────────────────────────
  const handleWinnerDetected = useCallback((winner: { address: string; guesses: number; potBalance: number } | null) => {
    if (!winner) return;
    setWinnerToastInfo(winner);
    // Reload cycle after a short delay so pot resets
    setTimeout(loadCycle, 3000);
  }, [loadCycle]);

  // ─────────────────────────────────────────────────────────────────────────
  const versionSwitchDisabled =
    phase === "starting" ||
    phase === "playing" ||
    phase === "attempt_expired" ||
    isSubmitting;

  // ── Won ──────────────────────────────────────────────────────────────────
  if (phase === "won" && cycle && attempt) {
    return (
      <WinScreen
        potWon={cycle.potBalance}
        totalGuesses={attempt.guesses.length}
        theme={cycle.themeConfig}
        version={version}
        cycleId={cycle.cycleId}
        onClose={() => { setAttempt(null); setPhase("browsing"); loadCycle(); }}
      />
    );
  }

  // ── Dead / exhausted ─────────────────────────────────────────────────────
  if (phase === "exhausted" && cycle) {
    return (
      <DeathScreen
        potLost={cycle.potBalance}
        version={version}
        theme={cycle.themeConfig}
        bestLockedCount={attempt ? Math.max(...attempt.guesses.map(g => g.feedback.filter(f => f === "locked").length), 0) : null}
        communityBestLocked={null}
        totalAttempts={attempt?.totalAttemptsUsed ?? 0}
        nextCycleIn={cycle.secondsRemaining}
        onClose={() => setPhase("browsing")}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#F7FAFA] pb-28 font-sterling">
      <div className="px-4 pt-4">
        <CrackPotHeader
          onBack={() => router.push("/games")}
          onInfoOpen={cycle ? () => setShowTutorial(true) : undefined}
        />
      </div>

      <div className="px-4 pt-2">
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-white p-1">
          {(["miles", "usdt"] as PlayVersion[]).map((v) => {
            const selected = version === v;
            return (
              <button
                key={v}
                type="button"
                disabled={versionSwitchDisabled}
                onClick={() => setVersion(v)}
                className={[
                  "rounded-lg px-3 py-2 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                  selected
                    ? "bg-[#238D9D] text-white"
                    : "bg-transparent text-slate-500 hover:bg-slate-50",
                ].join(" ")}
              >
                {v === "miles" ? "Miles" : "USDT"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tutorial overlay */}
      {showTutorial && cycle && (
        <TutorialOverlay
          theme={cycle.themeConfig}
          onDismiss={() => { setShowTutorial(false); markTutorialSeen(); }}
        />
      )}

      {/* Attempt expired modal */}
      {phase === "attempt_expired" && attempt && cycle && (
        <AttemptExpiredModal
          guesses={attempt.guesses}
          theme={cycle.themeConfig}
          freeAttemptsLeft={version === "miles" ? Math.max(0, FREE_ATTEMPTS_PER_CYCLE - attempt.freeAttemptsUsed) : 0}
          retryLabel={version === "usdt" ? `Pay $${ENTRY_FEE_USDT.toFixed(2)} for another attempt` : "Unlock more attempts"}
          onTryAgain={tryAgain}
          onDismiss={() => setPhase("browsing")}
        />
      )}

      {/* Loading skeleton */}
      {phase === "loading" && (
        <div className="px-4 pt-8 space-y-4 animate-pulse">
          <div className="h-48 rounded-xl bg-slate-100" />
          <div className="h-10 rounded-lg bg-slate-100" />
        </div>
      )}

      {/* Error */}
      {phase === "error" && (
        <section className="px-4 pt-12 text-center">
          <p className="text-2xl font-bold text-slate-800">Oops</p>
          <p className="mt-2 text-sm text-slate-500">{errorMsg ?? "Could not load CrackPot"}</p>
          <button
            onClick={() => { setPhase("loading"); loadCycle(); }}
            className="mt-6 px-6 py-3 rounded-xl bg-[#238D9D] text-white text-sm font-bold"
          >
            Retry
          </button>
        </section>
      )}

      {/* Main game content */}
      {cycle && phase !== "loading" && phase !== "error" && (
        <div className="px-4 pt-2 space-y-4">
          {/* Pot display */}
          <PotDisplay
            potState={cycle.potState}
            potBalance={cycle.potBalance}
            potCap={cycle.potCap}
            secondsRemaining={cycle.secondsRemaining}
            theme={cycle.themeConfig}
            version={version}
          />

          {/* Commitment disclosure */}
          {cycle.secretCommitment && (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-[11px] text-slate-400 font-mono break-all">
              <span className="font-semibold text-slate-500 not-italic">Commitment: </span>
              {cycle.secretCommitment}
            </div>
          )}

          {/* Attempt timer */}
          {phase === "playing" && attempt && (
            <AttemptTimer
              expiresAt={attempt.expiresAt}
              accentColor={cycle.themeConfig.accentColor}
            />
          )}

          {/* Previous guesses */}
          {phase === "playing" && attempt && attempt.guesses.length > 0 && (
            <GuessFeedback
              guesses={attempt.guesses}
              theme={cycle.themeConfig}
              newGuessNumber={attempt.guesses.length}
            />
          )}

          {/* Guess board (active) */}
          {phase === "playing" && (
            <GuessBoard
              theme={cycle.themeConfig}
              symbolOrder={symbolOrder}
              onSubmit={submitGuess}
              isSubmitting={isSubmitting}
              cooldownSeconds={cooldown}
              disabled={false}
            />
          )}

          {/* Browsing / starting state — start button */}
          {(phase === "browsing" || phase === "starting") && (
            <div className="space-y-3">
              {errorMsg && (
                <p className="text-center text-sm text-red-500">{errorMsg}</p>
              )}
              <button
                disabled={phase === "starting"}
                onClick={startAttempt}
                className="w-full h-14 rounded-xl bg-[#238D9D] text-white text-base font-bold disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {phase === "starting" ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    {startStepLabel(startStep, version, !!pendingUsdtTxHash)}
                  </>
                ) : (
                  startStepLabel("idle", version, !!pendingUsdtTxHash)
                )}
              </button>
              <p className="text-center text-xs text-slate-400">
                {version === "usdt"
                  ? `60 seconds · 2 guesses per attempt · exact feedback · $${ENTRY_FEE_USDT.toFixed(2)} per entry`
                  : `60 seconds · 2 guesses per attempt · ${FREE_ATTEMPTS_PER_CYCLE} free attempts per cycle`}
              </p>
            </div>
          )}

          {/* Cycle cracked by someone else */}
          {phase === "cycle_cracked" && (
            <div className="rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-5 text-center">
              <p className="text-xl font-bold text-yellow-800">💥 Pot Cracked!</p>
              <p className="mt-1 text-sm text-yellow-700">
                Someone cracked the code. New cycle starts soon.
              </p>
              <button
                onClick={() => { setPhase("loading"); loadCycle(); }}
                className="mt-4 px-6 py-2 rounded-lg bg-[#238D9D] text-white text-sm font-bold"
              >
                Reload
              </button>
            </div>
          )}

          {/* Live feed */}
          <LiveFeed
            version={version}
            accentColor={cycle.themeConfig.accentColor}
            onWinnerDetected={handleWinnerDetected}
          />
        </div>
      )}

      {/* Winner toast — shown when LiveFeed detects a winner */}
      {winnerToastInfo && cycle && (
        <CrackPotWinnerToast
          winner={winnerToastInfo}
          version={version}
          iWon={false}
          onClose={() => setWinnerToastInfo(null)}
        />
      )}
    </main>
  );
}
