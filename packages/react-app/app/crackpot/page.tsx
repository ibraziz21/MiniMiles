"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useWeb3 } from "@/contexts/useWeb3";
import { useIsMiniPay } from "@/hooks/useIsMiniPay";

import { CrackPotHeader } from "@/components/crackpot/CrackPotHeader";
import { PotDisplay } from "@/components/crackpot/PotDisplay";
import { GuessBoard } from "@/components/crackpot/GuessBoard";
import { GuessFeedback } from "@/components/crackpot/GuessFeedback";
import { AttemptTimer } from "@/components/crackpot/AttemptTimer";
import { AttemptExpiredModal } from "@/components/crackpot/AttemptExpiredModal";
import { LiveFeed } from "@/components/crackpot/LiveFeed";
import { CrackPotWinnerToast } from "@/components/crackpot/CrackPotWinnerToast";
import { TutorialOverlay, useTutorialSeen } from "@/components/crackpot/TutorialOverlay";
import { WinScreen } from "@/components/crackpot/WinScreen";
import { DeathScreen } from "@/components/crackpot/DeathScreen";

import {
  type CycleView,
  type PlayerCycleState,
  type GuessView,
  type CrackPotVersion,
  THEMES,
  FREE_ATTEMPTS_PER_CYCLE,
  ENTRY_FEE_MILES,
  ENTRY_FEE_USDT,
  UPSELL_COST_MILES,
  UPSELL_COST_USDT,
} from "@/lib/crackpotTypes";
import { akibaMilesSymbol, usdtSymbol } from "@/lib/svg";
import { TokenAmount } from "@/components/crackpot/TokenAmount";

function shuffleSymbols(address: string): number[] {
  const order = [0, 1, 2, 3, 4, 5];
  const seed = address.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  for (let i = 5; i > 0; i--) {
    const j = (seed * (i + 7)) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

type WinState = { potWon: number; potWonUsdt?: number; totalGuesses: number; cycleId?: string } | null;

export default function CrackPotPage() {
  const router = useRouter();
  const { address, enterCrackPotGame, approveUsdtForCrackPot, getStablecoinBalance } = useWeb3();
  const isMiniPay = useIsMiniPay();
  const allowUsdt = isMiniPay === false;
  const [tutorialSeen, markTutorialSeen] = useTutorialSeen();
  const [showTutorial, setShowTutorial] = useState(false);

  const [version, setVersion] = useState<CrackPotVersion>("miles");
  const [cycle, setCycle] = useState<CycleView | null>(null);
  const [player, setPlayer] = useState<PlayerCycleState | null>(null);
  const [isLoadingCycle, setIsLoadingCycle] = useState(true);

  const [isApproving, setIsApproving] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [usdtBalance, setUsdtBalance] = useState<string | null>(null);

  const [guesses, setGuesses] = useState<GuessView[]>([]);
  const [newGuessNumber, setNewGuessNumber] = useState<number | undefined>(undefined);
  const [livePotBalance, setLivePotBalance] = useState<number | null>(null);
  const [winState, setWinState] = useState<WinState>(null);
  const [showDeathScreen, setShowDeathScreen] = useState(false);
  const [showExpiredModal, setShowExpiredModal] = useState(false);
  const [winnerToast, setWinnerToast] = useState<{ address: string; guesses: number; potBalance: number } | null>(null);
  const seenWinnerRef = useRef<string | null>(null);
  const [communityBestLocked, setCommunityBestLocked] = useState<number | null>(null);
  const [cycleTotalAttempts, setCycleTotalAttempts] = useState(0);

  const cooldownRef = useRef<NodeJS.Timeout | null>(null);

  const symbolOrder = useMemo(
    () => (address ? shuffleSymbols(address) : [0, 1, 2, 3, 4, 5]),
    [address],
  );

  const isUsdt = version === "usdt";

  // ── Load cycle ──────────────────────────────────────────────────

  const loadCycle = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/crackpot/cycle/current?address=${address}&version=${version}`);
      if (!res.ok) return;
      const data = await res.json();
      const incoming = data.cycle as CycleView;
      // If a new cycle just rolled in, clear stale attempt/guess state
      setCycle((prev) => {
        if (prev && prev.cycleId !== incoming.cycleId) {
          setGuesses([]);
          setNewGuessNumber(undefined);
          setLivePotBalance(null);
          setShowExpiredModal(false);
        }
        return incoming;
      });

      const p = data.player as PlayerCycleState;
      setPlayer(p);
      if (p?.activeAttempt?.guesses) setGuesses(p.activeAttempt.guesses);
      if (data.cycle?.status === "dead") {
        setShowDeathScreen(true);
        // Fetch community stats for the death screen
        fetch(`/api/crackpot/feed?version=${version}`)
          .then((r) => r.json())
          .then((feed) => {
            setCommunityBestLocked(feed.bestLocked ?? null);
            setCycleTotalAttempts(feed.totalAttempts ?? 0);
          }).catch(() => {});
      }
      if (data.cycle?.status === "active" && !tutorialSeen) setShowTutorial(true);

      // Show expiry modal if player had an active attempt that just expired
      const prevAttempt = p?.activeAttempt;
      if (prevAttempt && new Date(prevAttempt.expiresAt) < new Date() && !winState) {
        setShowExpiredModal(true);
      }
    } catch (e) {
      console.error("[CrackPot] loadCycle:", e);
    } finally {
      setIsLoadingCycle(false);
    }
  }, [address, version]);

  useEffect(() => {
    setIsLoadingCycle(true);
    setCycle(null);
    setPlayer(null);
    setGuesses([]);
    setNewGuessNumber(undefined);
    setLivePotBalance(null);
    setWinState(null);
    setShowDeathScreen(false);
    setShowExpiredModal(false);
    setIsApproved(false);
    loadCycle();
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadCycle();
    const id = setInterval(loadCycle, 15_000);
    return () => clearInterval(id);
  }, [loadCycle]);

  // ── USDT balance ────────────────────────────────────────────────

  useEffect(() => {
    if (!address || !isUsdt || !allowUsdt) { setUsdtBalance(null); return; }
    getStablecoinBalance().then(setUsdtBalance).catch(() => setUsdtBalance(null));
  }, [address, isUsdt, allowUsdt, getStablecoinBalance]);

  // ── Cooldown timer ──────────────────────────────────────────────

  function startCooldown(seconds: number) {
    setCooldownSeconds(seconds);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldownSeconds((s) => {
        if (s <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return s - 1;
      });
    }, 1000);
  }

  // ── Approve USDT ────────────────────────────────────────────────

  async function handleApprove(amountUsd: number) {
    if (!address || isApproving || !allowUsdt) return;
    setIsApproving(true);
    try {
      await approveUsdtForCrackPot(amountUsd);
      setIsApproved(true);
    } catch (e: any) {
      alert(e?.message ?? "Approval failed");
    } finally {
      setIsApproving(false);
    }
  }

  // ── Start attempt ───────────────────────────────────────────────

  async function handleStartAttempt() {
    if (!address || isStarting || !cycle) return;
    // USDT: approve first if not done
    if (isUsdt && !isApproved) {
      await handleApprove(ENTRY_FEE_USDT);
      return;
    }
    setIsStarting(true);
    try {
      // Step 1: player calls enterGame on-chain — burns Miles or pulls USDT
      const contractVersion = isUsdt ? 1 : 0;
      let txHash: string;
      try {
        txHash = await enterCrackPotGame(contractVersion as 0 | 1);
      } catch (e: any) {
        alert(e?.shortMessage ?? e?.message ?? "Transaction rejected");
        return;
      }

      // Step 2: server verifies the tx and opens a 2-minute attempt session
      const res = await fetch("/api/crackpot/attempt/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, version, txHash }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Failed to start attempt");
        return;
      }
      setGuesses([]);
      setIsApproved(false);
      if (isUsdt) getStablecoinBalance().then(setUsdtBalance).catch(() => {});
      await loadCycle();
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setIsStarting(false);
    }
  }

  // ── Submit guess ────────────────────────────────────────────────

  async function handleGuess(symbols: [number, number, number, number]) {
    if (!address || !player?.activeAttempt || isSubmittingGuess) return;
    setIsSubmittingGuess(true);
    try {
      const res = await fetch("/api/crackpot/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, attemptId: player.activeAttempt.attemptId, symbols }),
      });
      const data = await res.json();

      if (res.status === 429) { startCooldown(data.secondsRemaining ?? 15); return; }
      if (!res.ok) { alert(data.error ?? "Guess failed"); return; }

      const newGuess = data.guess as GuessView;
      setGuesses((prev) => [...prev, newGuess]);
      setNewGuessNumber(newGuess.guessNumber);
      // Live pot update — don't wait for next poll
      if (data.potBalance !== undefined) setLivePotBalance(data.potBalance);
      startCooldown(15);

      if (data.won) {
        setWinState({ potWon: data.potWon ?? 0, potWonUsdt: data.potWonUsdt, totalGuesses: data.totalGuesses, cycleId: cycle?.cycleId });
        if (isUsdt) getStablecoinBalance().then(setUsdtBalance).catch(() => {});
        // Poll aggressively until the new rolling cycle appears (seeded async by guess route)
        setLivePotBalance(null);
        setNewGuessNumber(undefined);
        let attempts = 0;
        const waitForNewCycle = setInterval(async () => {
          attempts++;
          await loadCycle();
          // loadCycle sets cycle state; new cycle will have status=active and different id
          if (attempts >= 8) clearInterval(waitForNewCycle);
        }, 1500);
        return;
      }
      if (data.raced) { await loadCycle(); return; }
      await loadCycle();
    } catch {
      alert("Network error. Please try again.");
    } finally {
      setIsSubmittingGuess(false);
    }
  }

  // ── Upsell ──────────────────────────────────────────────────────

  async function handleUpsell() {
    if (!address || !cycle) return;
    const costLabel = isUsdt ? `$${UPSELL_COST_USDT.toFixed(2)} USDT` : `${UPSELL_COST_MILES} Miles`;
    const potLabel = isUsdt
      ? `$${(cycle.potBalanceUsdt ?? 0).toFixed(2)}`
      : `${cycle.potBalance.toLocaleString()}`;
    const confirmed = confirm(`Unlock 3 more attempts for ${costLabel}?\nPot is currently at ${potLabel}.`);
    if (!confirmed) return;

    // Upsell uses the same on-chain enterGame path as a regular entry so that
    // USDT always flows through the contract (not the relayer).
    if (isUsdt && !isApproved) {
      await handleApprove(UPSELL_COST_USDT);
      return;
    }

    try {
      const contractVersion = isUsdt ? 1 : 0;
      let txHash: string;
      try {
        txHash = await enterCrackPotGame(contractVersion as 0 | 1);
      } catch (e: any) {
        alert(e?.shortMessage ?? e?.message ?? "Transaction rejected");
        return;
      }

      const res = await fetch("/api/crackpot/attempt/upsell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, version, txHash }),
      });
      const data = await res.json();
      if (!res.ok) { alert(data.error ?? "Upsell failed"); return; }
      setIsApproved(false);
      if (isUsdt) getStablecoinBalance().then(setUsdtBalance).catch(() => {});
      await loadCycle();
    } catch {
      alert("Network error. Please try again.");
    }
  }

  // ── Derived ─────────────────────────────────────────────────────

  const theme = cycle ? THEMES[cycle.theme] : null;
  const hasActiveAttempt = !!player?.activeAttempt;
  const attemptExpired = player?.activeAttempt
    ? new Date(player.activeAttempt.expiresAt) < new Date()
    : false;
  const canPlay = hasActiveAttempt && !attemptExpired && cycle?.status === "active";
  const freeLeft = FREE_ATTEMPTS_PER_CYCLE - (player?.freeAttemptsUsed ?? 0);
  const needsUpsell = freeLeft <= 0 && !hasActiveAttempt;
  const cycleActive = cycle?.status === "active";

  const entryAmount = isUsdt ? `$${ENTRY_FEE_USDT.toFixed(2)}` : ENTRY_FEE_MILES.toString();
  const potAmount = isUsdt
    ? `$${(cycle?.potBalanceUsdt ?? 0).toFixed(2)}`
    : (cycle?.potBalance ?? 0).toLocaleString();
  const upsellAmount = isUsdt ? `$${UPSELL_COST_USDT.toFixed(2)}` : UPSELL_COST_MILES.toString();

  // ── Render ───────────────────────────────────────────────────────

  if (isLoadingCycle || !cycle || !theme) {
    return (
      <main className="min-h-dvh bg-white flex items-center justify-center">
        <div className="text-slate-400 text-sm animate-pulse">Loading CrackPot…</div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-slate-50 via-white to-white text-slate-900">
      <div className="w-full max-w-md mx-auto px-4 pt-4 pb-28 space-y-4">

        <CrackPotHeader onBack={() => router.back()} />

        {/* Version selector */}
        <div className="flex gap-2 p-1 bg-slate-100 rounded-2xl">
          {(["miles", "usdt"] as CrackPotVersion[]).map((v) => {
            if (v === "usdt" && !allowUsdt) return null;
            const active = version === v;
            return (
              <button
                key={v}
                onClick={() => setVersion(v)}
                className={[
                  "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all",
                  active ? "bg-white shadow text-slate-900" : "text-slate-500",
                ].join(" ")}
              >
                <Image src={v === "usdt" ? usdtSymbol : akibaMilesSymbol} alt={v} width={16} height={16} />
                {v === "usdt" ? "USDT" : "Miles"}
              </button>
            );
          })}
        </div>

        {/* USDT balance strip */}
        {isUsdt && usdtBalance !== null && (
          <div className="flex items-center gap-1 text-xs text-slate-500 px-1">
            <span>Balance:</span>
            <TokenAmount amount={`$${parseFloat(usdtBalance).toFixed(2)}`} isUsdt textClass="font-semibold text-slate-700" symbolSize={13} gap="gap-0.5" />
          </div>
        )}

        {/* Pot + timer */}
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-4">
          <PotDisplay
            potState={cycle.potState}
            potBalance={livePotBalance ?? cycle.potBalance}
            potBalanceUsdt={livePotBalance !== null && isUsdt ? livePotBalance / 100 : cycle.potBalanceUsdt}
            potCap={cycle.potCap}
            secondsRemaining={cycle.secondsRemaining}
            theme={theme}
            version={version}
          />
        </div>

        {/* Live social feed */}
        {cycleActive && theme && (
          <LiveFeed
            version={version}
            accentColor={theme.accentColor}
            onWinnerDetected={(w) => {
              if (!w || seenWinnerRef.current === w.address + w.guesses) return;
              seenWinnerRef.current = w.address + w.guesses;
              setWinnerToast(w);
            }}
          />
        )}

        {/* Game area */}
        {cycleActive && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-4 space-y-4">
            {!hasActiveAttempt || attemptExpired ? (
              <div className="flex flex-col items-center gap-3 py-4 text-center">
                {needsUpsell ? (
                  <>
                    <p className="text-sm text-slate-500">Free attempts used. Unlock 3 more.</p>
                    {/* Pot size */}
                    <div className="flex items-center gap-1.5 font-bold text-lg" style={{ color: theme.accentColor }}>
                      <span>Pot:</span>
                      <TokenAmount amount={potAmount} isUsdt={isUsdt} symbolSize={18} textClass="font-bold text-lg" gap="gap-1" />
                    </div>
                    <button
                      onClick={handleUpsell}
                      className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white transition-all active:scale-[0.98] flex items-center justify-center gap-2"
                      style={{ backgroundColor: theme.accentColor }}
                    >
                      Unlock 3 More —
                      <TokenAmount amount={upsellAmount} isUsdt={isUsdt} symbolSize={15} textClass="font-bold" gap="gap-1" />
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-slate-500">
                      {freeLeft > 0 ? `${freeLeft} free attempt${freeLeft > 1 ? "s" : ""} remaining` : "Start an attempt to crack the code"}
                    </p>
                    {/* Entry + Pot info row */}
                    <div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-600 flex-wrap">
                      <span className="flex items-center gap-1">
                        Entry:
                        <TokenAmount amount={entryAmount} isUsdt={isUsdt} symbolSize={14} textClass="font-semibold text-slate-800" gap="gap-1" />
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="flex items-center gap-1">
                        Pot:
                        <TokenAmount amount={potAmount} isUsdt={isUsdt} symbolSize={14} textClass="font-bold" gap="gap-1" />
                      </span>
                    </div>

                    {/* USDT: approve → enter two-step */}
                    {isUsdt && !isApproved ? (
                      <button
                        onClick={() => handleApprove(ENTRY_FEE_USDT)}
                        disabled={isApproving || !address}
                        className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                        style={{ backgroundColor: theme.accentColor }}
                      >
                        {isApproving ? "Approving…" : <>Approve <TokenAmount amount={entryAmount} isUsdt symbolSize={15} textClass="font-bold" gap="gap-1" /></>}
                      </button>
                    ) : (
                      <button
                        onClick={handleStartAttempt}
                        disabled={isStarting || !address}
                        className="w-full max-w-xs py-3.5 rounded-2xl font-bold text-white transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                        style={{ backgroundColor: theme.accentColor }}
                      >
                        {isStarting ? "Starting…" : (
                          <>
                            {isUsdt ? "Enter Pot —" : "Burn"}
                            <TokenAmount amount={entryAmount} isUsdt={isUsdt} symbolSize={15} textClass="font-bold" gap="gap-1" />
                            {!isUsdt && "& Enter"}
                          </>
                        )}
                      </button>
                    )}
                  </>
                )}

                {guesses.length > 0 && (
                  <div className="w-full mt-2">
                    <GuessFeedback guesses={guesses} theme={theme} newGuessNumber={newGuessNumber} />
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {/* Attempt header */}
                <div className="flex justify-between items-center text-xs text-slate-400">
                  <span>
                    Attempt {player?.activeAttempt?.attemptNumber} · Guess {(player?.activeAttempt?.guessesUsed ?? 0) + 1}
                  </span>
                  <span className="font-medium text-slate-500">2 min</span>
                </div>

                {/* Attempt timer bar */}
                {player?.activeAttempt && (
                  <AttemptTimer
                    expiresAt={player.activeAttempt.expiresAt}
                    accentColor={theme.accentColor}
                  />
                )}

                <GuessBoard
                  theme={theme}
                  symbolOrder={symbolOrder}
                  onSubmit={handleGuess}
                  isSubmitting={isSubmittingGuess}
                  cooldownSeconds={cooldownSeconds}
                  disabled={!canPlay}
                />
                <GuessFeedback
                  guesses={guesses}
                  theme={theme}
                  newGuessNumber={newGuessNumber}
                />
              </div>
            )}
          </div>
        )}

        {!cycleActive && !winState && !showDeathScreen && (
          <div className="bg-white rounded-3xl shadow-sm border border-slate-100 p-6 text-center">
            <div className="text-4xl mb-2">{cycle.status === "cracked" ? "💥" : "💀"}</div>
            <h3 className="font-bold text-slate-800">
              {cycle.status === "cracked" ? "Code was cracked!" : "Pot imploded"}
            </h3>
            <p className="text-sm text-slate-400 mt-1">New cycle coming soon.</p>
          </div>
        )}
      </div>

      {/* Winner toast — shown to all players when someone cracks it */}
      {winnerToast && !winState && (
        <CrackPotWinnerToast
          winner={winnerToast}
          version={version}
          iWon={false}
          onClose={() => setWinnerToast(null)}
        />
      )}

      {/* First-time tutorial */}
      {showTutorial && theme && (
        <TutorialOverlay
          theme={theme}
          onDismiss={() => {
            markTutorialSeen();
            setShowTutorial(false);
          }}
        />
      )}

      {/* Attempt expired bottom-sheet */}
      {showExpiredModal && theme && !winState && (
        <AttemptExpiredModal
          guesses={guesses}
          theme={theme}
          freeAttemptsLeft={Math.max(0, 3 - (player?.freeAttemptsUsed ?? 0))}
          onTryAgain={() => {
            setShowExpiredModal(false);
            handleStartAttempt();
          }}
          onDismiss={() => setShowExpiredModal(false)}
        />
      )}

      {winState && theme && (
        <WinScreen
          potWon={winState.potWon}
          potWonUsdt={winState.potWonUsdt}
          totalGuesses={winState.totalGuesses}
          theme={theme}
          version={version}
          cycleId={winState.cycleId}
          onClose={() => setWinState(null)}
        />
      )}

      {showDeathScreen && theme && (
        <DeathScreen
          potLost={cycle.potBalance}
          version={version}
          theme={theme}
          bestLockedCount={player?.bestGuessCount ?? null}
          communityBestLocked={communityBestLocked}
          totalAttempts={cycleTotalAttempts}
          nextCycleIn={cycle.secondsRemaining}
          onClose={() => { setShowDeathScreen(false); router.back(); }}
        />
      )}
    </main>
  );
}
