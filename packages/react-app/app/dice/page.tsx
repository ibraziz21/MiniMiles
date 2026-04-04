// app/dice/page.tsx
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { useWeb3 } from "@/contexts/useWeb3";
import { ResultModal } from "@/components/dice/ResultModal";
import { DiceStatsSheet } from "@/components/dice/DiceStats";
import { DiceHeader } from "@/components/dice/DiceHeader";
import { DicePotCard } from "@/components/dice/DicePotCard";
import { WinnerToast } from "@/components/dice/WinnerToast";
import { WinFeedTicker } from "@/components/dice/WinFeedTicker";
import { RoundHistoryFeed } from "@/components/dice/RoundHistoryFeed";

import {
  type DiceTier,
  type DiceRoundView,
  type DiceRoundStateName,
  type TierStats,
  type PlayerStats,
  type DiceMode,
  type MilesTier,
  type UsdTier,
  MILES_TIERS,
  USD_TIERS,
  USD_TIER_META,
  isUsdTierType,
} from "@/lib/diceTypes";

const DBG = (...args: any[]) => console.log("[DicePage]", ...args);

export default function DicePage() {
  const router = useRouter();
  const {
    address,
    fetchDiceRound,
    joinDice,
    approveUsdtForDice,
    getStablecoinBalance,
    getDiceTierStats,
    getDicePlayerStats,
    getLastResolvedRoundForPlayer,
  } = useWeb3();

  const [mode, setMode] = useState<DiceMode>("akiba");
  const [selectedTier, setSelectedTier] = useState<DiceTier>(10);

  const [round, setRound] = useState<DiceRoundView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);
  const [stablecoinBalance, setStablecoinBalance] = useState<string | null>(null);

  const [isRolling, setIsRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<number | null>(null);
  const [lastResultMessage, setLastResultMessage] = useState<string | null>(null);
  const [showResultModal, setShowResultModal] = useState(false);

  const [tierStatsByTier, setTierStatsByTier] =
    useState<Partial<Record<DiceTier, TierStats>>>({});
  const [playerStats, setPlayerStats] = useState<PlayerStats>(null);
  const [lastRoundByTier, setLastRoundByTier] =
    useState<Partial<Record<DiceTier, DiceRoundView | null>>>({});

  const [statsOpen, setStatsOpen] = useState(false);
  const [winnerToast, setWinnerToast] = useState<{
    roundId: bigint; winningNumber: number; winner: string; iWon: boolean;
  } | null>(null);

  const [drawingRoundId, setDrawingRoundId] = useState<bigint | null>(null);
  const [requestingRandomnessRoundId, setRequestingRandomnessRoundId] =
    useState<bigint | null>(null);
  const backgroundRandomnessRef = useRef<Set<string>>(new Set());
  const backgroundDrawRef = useRef<Set<string>>(new Set());

  /* ── Derived ────────────────────────────────────────────────── */

  const isUsdMode = mode === "usd";
  const isUsdTier = isUsdTierType(selectedTier);

  const potSize = useMemo(() => {
    const tier = round?.tier ?? selectedTier;
    return isUsdTierType(tier as DiceTier) ? 0 : (tier as number) * 6;
  }, [round, selectedTier]);

  const pot = useMemo(() => {
    const tier = (round?.tier ?? selectedTier) as DiceTier;
    if (isUsdTierType(tier)) {
      const meta = USD_TIER_META[tier];
      return { miles: meta.miles, usdt: meta.payout };
    }
    return { miles: (tier as number) * 6, usdt: 0 };
  }, [round, selectedTier]);

  // Keep a plain string for ResultModal which still uses text
  const potLabel = useMemo(() => {
    const tier = (round?.tier ?? selectedTier) as DiceTier;
    if (isUsdTierType(tier)) {
      const meta = USD_TIER_META[tier];
      return `$${meta.payout.toFixed(2)} USDT + ${meta.miles} Miles`;
    }
    return `${((tier as number) * 6).toLocaleString()} Miles`;
  }, [round, selectedTier]);

  const hasWinner = !!round?.winner;
  const logicalState: DiceRoundStateName = round?.state ?? "none";
  const isFinished = hasWinner;
  const myNumber = round?.myNumber ?? null;
  const hasJoinedInRound = myNumber != null;
  const hasJoinedActive = hasJoinedInRound && !isFinished;
  const hasJoinedLastResolved = hasJoinedInRound && isFinished;
  const displayState: DiceRoundStateName = isFinished ? "resolved" : logicalState;
  const isFinishedOrNoRound = !round || isFinished;
  const isDrawing = !!drawingRoundId && drawingRoundId === round?.roundId;
  const currentTierStats = tierStatsByTier[selectedTier] ?? null;

  const canJoin =
    !!address &&
    !!selectedNumber &&
    !isJoining &&
    (isFinishedOrNoRound || (round?.filledSlots ?? 0) < 6);

  /* ── Winner toast + refresh stats when round resolves ───────── */

  useEffect(() => {
    if (!round?.winner || !round.winningNumber || round.state !== "resolved") return;

    // Refresh player stats and last-round history so stats sheet is up to date
    if (address) {
      getDicePlayerStats().then(setPlayerStats).catch(() => {});
      loadLastRounds();
    }
    getDiceTierStats(selectedTier)
      .then((s) => setTierStatsByTier((p) => ({ ...p, [selectedTier]: s })))
      .catch(() => {});

    const key = `dice_winner_seen_${round.roundId.toString()}`;
    if (typeof window !== "undefined" && localStorage.getItem(key)) return;
    const iWon = !!address && round.winner.toLowerCase() === address.toLowerCase();
    setWinnerToast({
      roundId: round.roundId,
      winningNumber: round.winningNumber,
      winner: round.winner,
      iWon,
    });
  }, [round?.roundId, round?.winner, round?.state, address]); // eslint-disable-line react-hooks/exhaustive-deps

  function dismissWinnerToast() {
    if (!winnerToast) return;
    if (typeof window !== "undefined") {
      localStorage.setItem(`dice_winner_seen_${winnerToast.roundId.toString()}`, "1");
    }
    setWinnerToast(null);
  }

  /* ── Mode change ────────────────────────────────────────────── */

  function handleModeChange(newMode: DiceMode) {
    setMode(newMode);
    const firstTier = newMode === "akiba" ? MILES_TIERS[0] : USD_TIERS[0];
    setSelectedTier(firstTier);
    setDrawingRoundId(null);
    setShowResultModal(false);
    setDiceResult(null);
    setLastResultMessage(null);
    setSelectedNumber(null);
    setIsApproved(false);
    setWinnerToast(null);
  }

  /* ── USDT balance ───────────────────────────────────────────── */

  useEffect(() => {
    if (!address || !isUsdMode) { setStablecoinBalance(null); return; }
    getStablecoinBalance().then(setStablecoinBalance).catch(() => setStablecoinBalance(null));
  }, [address, isUsdMode, getStablecoinBalance]);

  /* ── Load round ─────────────────────────────────────────────── */

  const loadRound = useCallback(
    async (tier: DiceTier) => {
      DBG("loadRound()", tier);
      setIsLoading(true);
      try {
        const view = (await fetchDiceRound(tier)) as DiceRoundView;
        setRound(view);

        if (view.myNumber != null && !view.winner) {
          setSelectedNumber(view.myNumber);
        }

        getDiceTierStats(tier)
          .then((s) => setTierStatsByTier((p) => ({ ...p, [tier]: s })))
          .catch(() => {});

        if (address) {
          getDicePlayerStats().then(setPlayerStats).catch(() => {});
        }

        return view;
      } catch (e) {
        console.error("[DicePage] loadRound failed:", e);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchDiceRound, getDiceTierStats, getDicePlayerStats, address]
  );

  useEffect(() => { loadRound(selectedTier); }, [selectedTier, loadRound]);
  useEffect(() => {
    const id = setInterval(() => loadRound(selectedTier), 20000);
    return () => clearInterval(id);
  }, [selectedTier, loadRound]);

  /* ── Last round per tier (for stats sheet) ──────────────────── */

  const loadLastRounds = useCallback(async () => {
    if (!address) return;
    const allTiers: DiceTier[] = [...MILES_TIERS, ...USD_TIERS];
    const results = await Promise.allSettled(
      allTiers.map((t) => getLastResolvedRoundForPlayer(t))
    );
    const map: Partial<Record<DiceTier, DiceRoundView | null>> = {};
    results.forEach((r, i) => {
      map[allTiers[i]] = r.status === "fulfilled" ? (r.value as DiceRoundView | null) : null;
    });
    setLastRoundByTier(map);
  }, [address, getLastResolvedRoundForPlayer]);

  useEffect(() => { loadLastRounds(); }, [loadLastRounds]);

  /* ── Sweep all tiers ────────────────────────────────────────── */

  const sweepAllTiers = useCallback(async () => {
    const allTiers: DiceTier[] = [...MILES_TIERS, ...USD_TIERS];
    for (const tier of allTiers) {
      let view: DiceRoundView | null = null;
      try { view = await fetchDiceRound(tier); } catch { continue; }
      if (!view || view.roundId === 0n) continue;

      const key = `${tier}-${view.roundId.toString()}`;
      const hasPlayers = view.filledSlots > 0;
      const isFull = view.filledSlots === 6;
      const noWinner = !view.winner;

      if (
        hasPlayers && noWinner && view.randomBlock === 0n && view.state !== "resolved" &&
        !(tier === selectedTier && requestingRandomnessRoundId === view.roundId) &&
        !backgroundRandomnessRef.current.has(key)
      ) {
        backgroundRandomnessRef.current.add(key);
        try {
          const res = await fetch("/api/dice/randomness", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roundId: view.roundId.toString(), tier }),
          });
          if (!res.ok) backgroundRandomnessRef.current.delete(key);
        } catch { backgroundRandomnessRef.current.delete(key); }
      }

      if (
        isFull && noWinner && view.state === "ready" &&
        !(tier === selectedTier && drawingRoundId === view.roundId) &&
        !backgroundDrawRef.current.has(key)
      ) {
        backgroundDrawRef.current.add(key);
        try {
          const res = await fetch("/api/dice/draw", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ roundId: view.roundId.toString() }),
          });
          if (!res.ok) backgroundDrawRef.current.delete(key);
        } catch { backgroundDrawRef.current.delete(key); }
      }
    }
  }, [fetchDiceRound, selectedTier, requestingRandomnessRoundId, drawingRoundId]);

  useEffect(() => {
    sweepAllTiers();
    const id = setInterval(sweepAllTiers, 20000);
    return () => clearInterval(id);
  }, [sweepAllTiers]);

  /* ── Randomness trigger ─────────────────────────────────────── */

  useEffect(() => {
    if (!round) return;
    const shouldRequest =
      round.filledSlots > 0 && !round.winner && round.randomBlock === 0n && round.state !== "resolved";
    if (!shouldRequest || requestingRandomnessRoundId === round.roundId) return;

    setRequestingRandomnessRoundId(round.roundId);
    (async () => {
      try {
        const res = await fetch("/api/dice/randomness", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roundId: round.roundId.toString(), tier: selectedTier }),
        });
        if (!res.ok) { setRequestingRandomnessRoundId(null); return; }
        await loadRound(selectedTier);
      } catch {
        setRequestingRandomnessRoundId(null);
      }
    })();
  }, [round, requestingRandomnessRoundId, selectedTier, loadRound]);

  /* ── Draw trigger ───────────────────────────────────────────── */

  useEffect(() => {
    if (!round) return;
    const readyToDraw = round.filledSlots === 6 && !round.winner && round.state === "ready";
    if (!readyToDraw || drawingRoundId === round.roundId) return;

    setDrawingRoundId(round.roundId);
    setShowResultModal(true);
    setIsRolling(true);
    setDiceResult(null);
    setLastResultMessage(null);

    (async () => {
      try {
        const res = await fetch("/api/dice/draw", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roundId: round.roundId.toString() }),
        });
        if (!res.ok) setDrawingRoundId(null);

        const updated = await loadRound(selectedTier);
        if (!updated) return;

        const winning = updated.winningNumber ?? null;
        if (!winning) {
          setLastResultMessage("Draw sent. Waiting for result…");
          return;
        }
        setDiceResult(winning);
        if (updated.myNumber && updated.myNumber !== winning) {
          setLastResultMessage(`Winning number was ${winning}. Better luck next time.`);
        }
        // Refresh last rounds after a draw
        loadLastRounds();
      } catch {
        setLastResultMessage("Something went wrong. Please refresh.");
        setDrawingRoundId(null);
      } finally {
        setIsRolling(false);
      }
    })();
  }, [round, drawingRoundId, selectedTier, loadRound, loadLastRounds]);

  /* ── Handlers ───────────────────────────────────────────────── */

  function handleSelectNumber(n: number) {
    if (!round || round.winner) { setSelectedNumber(n); return; }
    if (round.myNumber != null) return;
    const slot = round.slots.find((s) => s.number === n);
    if (!slot) return;
    if (slot.player && address && slot.player.toLowerCase() !== address.toLowerCase()) return;
    setSelectedNumber(n);
    setIsApproved(false);
  }

  async function handleApprove() {
    if (!selectedNumber || !canJoin || isApproving || isApproved || !isUsdTier) return;
    const usdMeta = USD_TIER_META[selectedTier as UsdTier];
    if (!usdMeta) return;
    const entryUnits = BigInt(Math.round(usdMeta.entry * 1_000_000));
    try {
      setIsApproving(true);
      await approveUsdtForDice(entryUnits);
      setIsApproved(true);
    } catch (e) {
      console.error("[DicePage] approve failed:", e);
    } finally {
      setIsApproving(false);
    }
  }

  async function handleJoin() {
    if (!selectedNumber || !canJoin) return;
    if (isUsdTier && !isApproved) return;
    try {
      setIsJoining(true);
      await joinDice(selectedTier, selectedNumber);
      const updated = (await fetchDiceRound(selectedTier)) as DiceRoundView;
      setRound(updated);
      setSelectedNumber(updated.myNumber ?? selectedNumber);
      setIsApproved(false);

      // If first player, request randomness early
      if (updated.filledSlots === 1 && updated.randomBlock === 0n && !updated.winner) {
        setRequestingRandomnessRoundId(updated.roundId);
        try {
          const res = await fetch("/api/dice/randomness", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ roundId: updated.roundId.toString(), tier: selectedTier }),
          });
          if (!res.ok) setRequestingRandomnessRoundId(null);
          else await loadRound(selectedTier);
        } catch { setRequestingRandomnessRoundId(null); }
      }

      getDiceTierStats(selectedTier)
        .then((s) => setTierStatsByTier((p) => ({ ...p, [selectedTier]: s })))
        .catch(() => {});
      getDicePlayerStats().then(setPlayerStats).catch(() => {});
      if (isUsdTier) getStablecoinBalance().then(setStablecoinBalance).catch(() => {});
    } catch (e) {
      console.error("[DicePage] joinDice failed:", e);
    } finally {
      setIsJoining(false);
    }
  }

  /* ── Render ─────────────────────────────────────────────────── */

  return (
    <main className="min-h-dvh bg-gradient-to-b from-[#238D9D]/5 via-white to-white text-slate-900">
      <div className="w-full max-w-md mx-auto px-4 pt-4 pb-28 space-y-3">

        {/* Header */}
        <div>
          <DiceHeader
            onBack={() => router.back()}
            mode={mode}
            onModeChange={handleModeChange}
            selectedTier={selectedTier}
            onTierChange={(tier) => {
              setSelectedTier(tier);
              setRound(null);
              setDrawingRoundId(null);
              setShowResultModal(false);
              setDiceResult(null);
              setLastResultMessage(null);
              setSelectedNumber(null);
              setIsApproved(false);
            }}
            tierStats={currentTierStats}
            playerStats={playerStats}
            onOpenStats={() => setStatsOpen(true)}
            stablecoinBalance={stablecoinBalance}
          />
        </div>

        {/* Live win feed */}
        <WinFeedTicker />

        {/* Pot card — natural height */}
        <div>
          <DicePotCard
            round={round}
            selectedTier={selectedTier}
            potSize={potSize}
            selectedNumber={selectedNumber}
            myNumber={myNumber}
            isFinished={isFinished}
            hasJoinedActive={hasJoinedActive}
            hasJoinedLastResolved={hasJoinedLastResolved}
            displayState={displayState}
            onSelectNumber={handleSelectNumber}
            onJoin={handleJoin}
            onApprove={handleApprove}
            canJoin={canJoin}
            isJoining={isJoining}
            isApproving={isApproving}
            isApproved={isApproved}
            isLoading={isLoading}
            isDrawing={isDrawing}
            myAddress={address}
          />
        </div>

        {/* Round history */}
        <RoundHistoryFeed tier={selectedTier} />
      </div>

      {/* Winner toast — shown once per round, dismissed to localStorage */}
      {winnerToast && (
        <WinnerToast
          roundId={winnerToast.roundId}
          winningNumber={winnerToast.winningNumber}
          winner={winnerToast.winner}
          pot={pot}
          iWon={winnerToast.iWon}
          onClose={dismissWinnerToast}
        />
      )}

      {/* Overlays */}
      <ResultModal
        open={showResultModal && hasJoinedInRound}
        onClose={() => setShowResultModal(false)}
        diceResult={diceResult}
        isRolling={isRolling}
        lastResultMessage={lastResultMessage}
        selectedNumber={myNumber}
        potLabel={potLabel}
        slots={round?.slots}
      />

      <DiceStatsSheet
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        selectedTier={selectedTier}
        tierStatsByTier={tierStatsByTier}
        playerStats={playerStats}
        lastRoundByTier={lastRoundByTier}
        myAddress={address}
        onTierChange={(tier) => { setSelectedTier(tier); }}
      />
    </main>
  );
}
