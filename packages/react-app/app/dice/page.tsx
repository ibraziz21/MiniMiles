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

const DBG = (...args: any[]) => console.log("[DicePage]", ...args);

/* ────────────────────────────────────────────────────────────── */
/* Page                                                          */
/* ────────────────────────────────────────────────────────────── */

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

  // stats
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

  const isFinishedOrNoRound = !round || isFinished;

  const canJoin =
    !!address &&
    !!selectedNumber &&
    !isJoining &&
    (isFinishedOrNoRound || (round?.filledSlots ?? 0) < 6);

  DBG("render start", { address });
  DBG("derived state", {
    hasWinner,
    logicalState,
    isFinished,
    myNumber,
    hasJoinedInRound,
    hasJoinedActive,
  });
  DBG("canJoin computed", {
    selectedNumber,
    isJoining,
    isFinishedOrNoRound,
    filledSlots: round?.filledSlots ?? 0,
    canJoin,
  });

  /* ────────────────────────────────────────────────────────────── */
  /* Load round + stats                                            */
  /* ────────────────────────────────────────────────────────────── */

  const loadRound = useCallback(
    async (tier: DiceTier) => {
      DBG("loadRound() called", { tier });

      setIsLoading(true);
      try {
        const view = (await fetchDiceRound(tier)) as DiceRoundView;
        DBG("loadRound() fetched view", {
          tier: view.tier,
          roundId: view.roundId?.toString?.() ?? view.roundId,
          filledSlots: view.filledSlots,
          winner: view.winner,
          randomBlock: view.randomBlock?.toString?.(),
          myNumber: view.myNumber,
          state: view.state,
        });

        setRound(view);

        // 🧠 IMPORTANT:
        // If I already joined this round and it’s not resolved, keep my number.
        // BUT DO NOT CLEAR selectedNumber when myNumber is null → that was killing the button.
        if (view.myNumber != null && !view.winner) {
          DBG("loadRound() setting selectedNumber from myNumber", {
            myNumber: view.myNumber,
          });
          setSelectedNumber(view.myNumber);
        } else {
          DBG("loadRound() leaving selectedNumber as-is", {
            selectedNumber,
          });
        }

        // Tier stats
        getDiceTierStats(tier)
          .then((stats) => {
            DBG("getDiceTierStats() result", { tier, stats });
            setTierStatsByTier((prev) => ({
              ...prev,
              [tier]: stats,
            }));
          })
          .catch((e) =>
            console.warn("[DicePage] getDiceTierStats error", e)
          );

        // Player stats only if we have an address
        if (address) {
          getDicePlayerStats()
            .then((ps) => {
              DBG("getDicePlayerStats() result", ps);
              setPlayerStats(ps);
            })
            .catch((e) =>
              console.warn("[DicePage] getDicePlayerStats error", e)
            );
        }

        return view;
      } catch (e) {
        console.error("[DicePage] Failed to load dice round:", e);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [fetchDiceRound, getDiceTierStats, getDicePlayerStats, address, selectedNumber]
  );

  // initial load + on tier change
  useEffect(() => {
    DBG("useEffect initial load / tier change", { selectedTier });
    loadRound(selectedTier);
  }, [selectedTier, loadRound]);

  // poll every 15s so state stays fresh
  useEffect(() => {
    DBG("setting up polling interval");
    const id = setInterval(() => {
      DBG("poll tick → loadRound()", { selectedTier });
      loadRound(selectedTier);
    }, 15000);
    return () => {
      DBG("clearing polling interval");
      clearInterval(id);
    };
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

    DBG("draw effect check", {
      roundId: round.roundId?.toString?.() ?? round.roundId,
      filledSlots: round.filledSlots,
      winner: round.winner,
      randomBlock: round.randomBlock?.toString?.(),
      isFull,
      noWinner,
      hasRandom,
      iAmInRound,
      drawingRoundId: drawingRoundId?.toString?.(),
    });

    if (!isFull || !noWinner || !hasRandom || !iAmInRound) return;
    if (drawingRoundId === round.roundId) return;

    DBG("draw conditions met → triggering /api/dice/draw", {
      roundId: round.roundId?.toString?.(),
    });

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

        DBG("draw API response", { ok: res.ok, status: res.status });

        const updated = await loadRound(selectedTier);
        if (!updated) return;

        const winning = updated.winningNumber ?? null;
        DBG("post-draw updated round", {
          winning,
          myNumber: updated.myNumber,
        });

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
        console.error("[DicePage] draw API failed:", e);
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
    DBG("handleSelectNumber()", {
      n,
      roundId: round?.roundId?.toString?.(),
      roundState: round?.state,
      winner: round?.winner,
      myNumber: round?.myNumber,
    });

    // If no round yet (no active pot) or round is resolved, just allow picking.
    // We rely on on-chain logic to open a new round on join.
    if (!round || round.winner) {
      DBG("no active round or already resolved → free select", { n });
      setSelectedNumber(n);
      return;
    }

    // If I've already joined this round, don't allow changing
    if (round.myNumber != null) {
      DBG("already joined this round, ignoring selection");
      return;
    }

    const slot = round.slots.find((s) => s.number === n);
    if (!slot) {
      DBG("no slot found for n", { n });
      return;
    }

    // If slot is taken by someone else, ignore
    if (
      slot.player &&
      address &&
      slot.player.toLowerCase() !== address.toLowerCase()
    ) {
      DBG("slot taken by other player", {
        n,
        slotPlayer: slot.player,
        address,
      });
      return;
    }

    DBG("selection accepted", { n });
    setSelectedNumber(n);
  }

  async function handleJoin() {
    DBG("handleJoin() start", {
      selectedNumber,
      canJoin,
      address,
      roundId: round?.roundId?.toString?.(),
    });

    if (!selectedNumber || !canJoin) {
      DBG("handleJoin() guard failed", {
        selectedNumber,
        canJoin,
      });
      return;
    }

    try {
      setIsJoining(true);

      DBG("calling joinDice()", {
        tier: selectedTier,
        selectedNumber,
      });

      await joinDice(selectedTier, selectedNumber);

      DBG("joinDice() success, refreshing round");

      const updated = (await fetchDiceRound(selectedTier)) as DiceRoundView;
      DBG("post-join fetched round", {
        roundId: updated.roundId?.toString?.(),
        filledSlots: updated.filledSlots,
        myNumber: updated.myNumber,
        state: updated.state,
      });

      setRound(updated);
      setSelectedNumber(updated.myNumber ?? selectedNumber);

      // If this is the FIRST player, request randomness early.
      if (
        updated.filledSlots === 1 &&
        updated.randomBlock === 0n &&
        !updated.winner
      ) {
        DBG("first player joined → requesting randomness", {
          roundId: updated.roundId?.toString?.(),
        });
        try {
          const res = await fetch("/api/dice/randomness", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              roundId: updated.roundId.toString(),
              tier: selectedTier,
            }),
          });
          DBG("randomness API response", {
            ok: res.ok,
            status: res.status,
          });
        } catch (e) {
          console.error("[DicePage] request randomness failed", e);
        }
      }

      // Refresh stats async (don’t block UX)
      getDiceTierStats(selectedTier)
        .then((stats) => {
          DBG("refresh tier stats after join", { tier: selectedTier, stats });
          setTierStatsByTier((prev) => ({
            ...prev,
            [selectedTier]: stats,
          }));
        })
        .catch((e) =>
          console.error("[DicePage] getDiceTierStats after join failed", e)
        );

      getDicePlayerStats()
        .then((ps) => {
          DBG("refresh player stats after join", ps);
          setPlayerStats(ps);
        })
        .catch((e) =>
          console.error("[DicePage] getDicePlayerStats after join failed", e)
        );
    } catch (e) {
      console.error("[DicePage] joinDice failed:", e);
    } finally {
      setIsJoining(false);
      DBG("handleJoin() end");
    }
  }

  DBG("render end snapshot", {
    address,
    selectedTier,
    roundId: round?.roundId?.toString?.(),
    filledSlots: round?.filledSlots,
    selectedNumber,
    isJoining,
    canJoin,
  });

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
            DBG("tier change via header", { tier });
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
