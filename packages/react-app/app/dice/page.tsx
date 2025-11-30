// app/dice/page.tsx
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";

import { useWeb3 } from "@/contexts/useWeb3";
import { ResultModal } from "@/components/dice/ResultModal";
import { DiceStatsSheet } from "@/components/dice/DiceStats";
import { DiceHeader } from "@/components/dice/DiceHeader";
import { DicePotCard } from "@/components/dice/DicePotCard";

import {
  type DiceTier,
  type DiceRoundView,
  type DiceRoundStateName,
  type TierStats,
  type PlayerStats,
} from "@/lib/diceTypes";

export default function DicePage() {
  const router = useRouter();
  const {
    address,
    fetchDiceRound,
    joinDice,
    getDiceTierStats,
    getDicePlayerStats,
  } = useWeb3();

  const [selectedTier, setSelectedTier] = useState<DiceTier>(10);

  const [round, setRound] = useState<DiceRoundView | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState<number | null>(null);

  // modal / animation
  const [isRolling, setIsRolling] = useState(false);
  const [diceResult, setDiceResult] = useState<number | null>(null);
  const [lastResultMessage, setLastResultMessage] = useState<string | null>(
    null
  );
  const [showResultModal, setShowResultModal] = useState(false);

  // stats sheet
  const [tierStatsByTier, setTierStatsByTier] =
    useState<Partial<Record<DiceTier, TierStats>>>({});
  const [playerStats, setPlayerStats] = useState<PlayerStats>(null);

  const currentTierStats = tierStatsByTier[selectedTier] ?? null;
  const [statsOpen, setStatsOpen] = useState(false);

  // backend triggers (draw guard)
  const [drawingRoundId, setDrawingRoundId] = useState<bigint | null>(null);

  /* ────────────────────────────────────────────────────────────── */
  /* Derived state                                                 */
  /* ────────────────────────────────────────────────────────────── */

  const potSize = useMemo(() => {
    const tier = round?.tier ?? selectedTier;
    return tier * 6;
  }, [round, selectedTier]);

  const hasWinner = !!round?.winner;
  const logicalState: DiceRoundStateName = round?.state ?? "none";
  const isFinished = hasWinner;

  const myNumber = round?.myNumber ?? null;
  const hasJoinedInRound = myNumber != null;
  const hasJoinedActive = hasJoinedInRound && !isFinished;
  const hasJoinedLastResolved = hasJoinedInRound && isFinished;

  const displayState: DiceRoundStateName = isFinished
    ? "resolved"
    : logicalState;

  /* ────────────────────────────────────────────────────────────── */
  /* Load round + stats                                            */
  /* ────────────────────────────────────────────────────────────── */

  const loadRound = useCallback(
    async (tier: DiceTier) => {
      setIsLoading(true);
      try {
        const view = (await fetchDiceRound(tier)) as DiceRoundView;
        setRound(view);

        // If I already joined this round and it’s not resolved, keep my number selected.
        if (view.myNumber != null && !view.winner) {
          setSelectedNumber(view.myNumber);
        } else {
          setSelectedNumber(null);
        }

        // Tier stats (per tier)
        getDiceTierStats(tier)
          .then((stats) =>
            setTierStatsByTier((prev) => ({
              ...prev,
              [tier]: stats,
            }))
          )
          .catch((e) => console.warn("getDiceTierStats error", e));

        // Player stats (only if we have an address)
        if (address) {
          getDicePlayerStats()
            .then(setPlayerStats)
            .catch((e) =>
              console.warn("getDicePlayerStats error", e)
            );
        }

        return view;
      } catch (e) {
        console.error("Failed to load dice round:", e);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchDiceRound, getDiceTierStats, getDicePlayerStats, address]
  );

  useEffect(() => {
    loadRound(selectedTier);
  }, [selectedTier, loadRound]);

  // Poll every 15s so state stays fresh
  useEffect(() => {
    const id = setInterval(() => {
      loadRound(selectedTier);
    }, 15000);
    return () => clearInterval(id);
  }, [selectedTier, loadRound]);

  /* ────────────────────────────────────────────────────────────── */
  /* Backend triggers: draw + modal                                */
  /* ────────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!round) return;

    const isFull = round.filledSlots === 6;
    const noWinner = !round.winner;
    const hasRandom = round.randomBlock !== 0n;
    const iAmInRound = round.myNumber != null;

    if (!isFull || !noWinner || !hasRandom || !iAmInRound) return;
    if (drawingRoundId === round.roundId) return;

    setDrawingRoundId(round.roundId);

    setShowResultModal(true);
    setIsRolling(true);
    setDiceResult(null);
    setLastResultMessage(null);

    (async () => {
      try {
        await fetch("/api/dice/draw", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ roundId: round.roundId.toString() }),
        });

        const updated = await loadRound(selectedTier);
        if (!updated) return;

        const winning = updated.winningNumber ?? null;
        if (!winning) {
          setLastResultMessage(
            "Draw transaction sent. Waiting for the result…"
          );
          return;
        }

        setDiceResult(winning);

        const myNum = updated.myNumber;
        if (myNum && myNum !== winning) {
          setLastResultMessage(
            `Winning number was ${winning}. Better luck next time.`
          );
        }
      } catch (e) {
        console.error("draw API failed:", e);
        setLastResultMessage(
          "Something went wrong while drawing this pot. Please refresh."
        );
      } finally {
        setIsRolling(false);
      }
    })();
  }, [round, drawingRoundId, selectedTier, loadRound]);

  /* ────────────────────────────────────────────────────────────── */
  /* Handlers                                                      */
  /* ────────────────────────────────────────────────────────────── */

  function handleSelectNumber(n: number) {
    // If no round yet (no active pot) or round is resolved, just allow picking
    if (!round || round.winner) {
      setSelectedNumber(n);
      return;
    }

    // If I've already joined this round, don't allow changing
    if (round.myNumber != null) return;

    const slot = round.slots.find((s) => s.number === n);
    if (!slot) return;

    // If slot is taken by someone else, ignore
    if (
      slot.player &&
      address &&
      slot.player.toLowerCase() !== address.toLowerCase()
    ) {
      return;
    }

    setSelectedNumber(n);
  }

  const isFinishedOrNoRound = !round || isFinished;

  // 🔓 Mirror joinRaffle behaviour: don't hard-gate on address here.
  const canJoin =
    !!selectedNumber &&
    !isJoining &&
    (isFinishedOrNoRound || (round?.filledSlots ?? 0) < 6);

  async function handleJoin() {
    if (!selectedNumber || !canJoin) return;

    try {
      setIsJoining(true);

      // Let joinDice enforce wallet connectivity / network, same as joinRaffle.
      const hash = await joinDice(selectedTier, selectedNumber);
      console.log("[Dice] joinDice tx hash:", hash);

      const updated = (await fetchDiceRound(
        selectedTier
      )) as DiceRoundView;
      setRound(updated);
      setSelectedNumber(updated.myNumber ?? selectedNumber);

      // If this is the FIRST player, request randomness early.
      if (
        updated.filledSlots === 1 &&
        updated.randomBlock === 0n &&
        !updated.winner
      ) {
        try {
          await fetch("/api/dice/randomness", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              roundId: updated.roundId.toString(),
              tier: selectedTier,
            }),
          });
        } catch (e) {
          console.error("request randomness failed", e);
        }
      }

      // Refresh stats async
      getDiceTierStats(selectedTier)
        .then((stats) =>
          setTierStatsByTier((prev) => ({
            ...prev,
            [selectedTier]: stats,
          }))
        )
        .catch(console.error);

      getDicePlayerStats()
        .then(setPlayerStats)
        .catch(console.error);
    } catch (e) {
      console.error("joinDice failed:", e);
    } finally {
      setIsJoining(false);
    }
  }

  /* ────────────────────────────────────────────────────────────── */
  /* Render                                                        */
  /* ────────────────────────────────────────────────────────────── */

  return (
    <main className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-white text-slate-900">
      <div className="max-w-md mx-auto px-4 pb-24 pt-6 space-y-6 relative">
        <div className="pointer-events-none absolute -top-10 right-0 opacity-60 blur-sm">
          <div className="h-24 w-24 rounded-full bg-emerald-200/40" />
        </div>

        <DiceHeader
          onBack={() => router.back()}
          selectedTier={selectedTier}
          onTierChange={(tier) => {
            setSelectedTier(tier);
            setDrawingRoundId(null);
            setShowResultModal(false);
            setDiceResult(null);
            setLastResultMessage(null);
          }}
          tierStats={currentTierStats}
          playerStats={playerStats}
          onOpenStats={() => setStatsOpen(true)}
        />

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
          canJoin={canJoin}
          isJoining={isJoining}
          isLoading={isLoading}
        />
      </div>

      {/* Result modal – opened when we’re drawing & you are in the round */}
      <ResultModal
        open={showResultModal && hasJoinedInRound}
        onClose={() => setShowResultModal(false)}
        diceResult={diceResult}
        isRolling={isRolling}
        lastResultMessage={lastResultMessage}
        selectedNumber={myNumber}
        potSize={potSize}
      />

      <DiceStatsSheet
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        selectedTier={selectedTier}
        tierStatsByTier={tierStatsByTier}
        playerStats={playerStats}
      />
    </main>
  );
}
