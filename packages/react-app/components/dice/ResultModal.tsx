// components/dice/ResultModal.tsx
"use client";

import Image from "next/image";
import { Dice3D } from "./Dice3D";
import { akibaMilesSymbol } from "@/lib/svg";
import type { DiceSlot } from "@/lib/diceTypes";
import { shortAddress } from "@/lib/diceTypes";

export type ResultModalProps = {
  open: boolean;
  onClose: () => void;
  diceResult: number | null;
  isRolling: boolean;
  lastResultMessage: string | null;
  selectedNumber: number | null;
  /** Display label for the pot value (e.g. "180 Miles" or "$1.00 USDT + 100 Miles") */
  potLabel: string;
  /** All 6 slots from the round – used to show each player's die */
  slots?: DiceSlot[];
};

export function ResultModal({
  open,
  onClose,
  diceResult,
  isRolling,
  lastResultMessage,
  selectedNumber,
  potLabel,
  slots,
}: ResultModalProps) {
  if (!open) return null;

  const userWon =
    !isRolling && diceResult !== null && selectedNumber === diceResult;
  const userLost =
    !isRolling &&
    diceResult !== null &&
    selectedNumber != null &&
    selectedNumber !== diceResult;

  const showGrid = slots && slots.length === 6;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-3xl bg-white shadow-2xl border border-slate-200 p-5 space-y-4 relative overflow-hidden">
        {/* Accent gradient halo */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-[#238D9D]/20 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-[#238D9D]/10 blur-3xl" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 relative z-10">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1 rounded-full bg-[#238D9D]/10 px-2 py-0.5 border border-[#238D9D]/20">
              <span className="h-1.5 w-1.5 rounded-full bg-[#238D9D]" />
              <span className="text-[10px] font-medium text-[#238D9D] tracking-wide uppercase">
                Akiba Dice
              </span>
            </div>
            <h2 className="text-base font-semibold text-slate-900">
              {isRolling
                ? "Rolling the dice…"
                : userWon
                ? "You won the pot!"
                : userLost
                ? "You didn't win this pot"
                : "This pot has been drawn"}
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              6 players filled this pot. The dice locks in a single number –
              whoever picked it takes the balance.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-slate-700"
          >
            ✕
          </button>
        </div>

        {/* Pot chip */}
        <div className="relative z-10 flex items-center justify-center">
          <div className="inline-flex items-center gap-2 rounded-full bg-slate-900 text-white px-3 py-1 shadow-md shadow-slate-900/40">
            <div className="h-6 w-6 rounded-full bg-[#238D9D] flex items-center justify-center shadow">
              <Image src={akibaMilesSymbol} alt="Akiba" className="h-3 w-3" />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-wide text-slate-300">Pot value</span>
              <span className="text-xs font-semibold">{potLabel}</span>
            </div>
          </div>
        </div>

        {/* Dice display: 6-die grid or single die */}
        <div className="relative z-10">
          {showGrid ? (
            <div className="grid grid-cols-3 gap-1.5">
              {slots!.map((slot) => {
                const isWinner = !isRolling && diceResult !== null && slot.number === diceResult;
                const isMySlot = slot.number === selectedNumber;
                const hasPlayer = !!slot.player;

                return (
                  <div key={slot.number} className="space-y-0.5">
                    <div
                      className={`h-20 rounded-xl transition-all ${
                        isWinner
                          ? "ring-2 ring-[#238D9D] shadow-[0_0_12px_rgba(35,141,157,0.5)]"
                          : !isRolling && diceResult !== null
                          ? "opacity-40"
                          : ""
                      }`}
                    >
                      <Dice3D
                        value={hasPlayer ? (isRolling ? null : slot.number) : null}
                        rolling={isRolling && hasPlayer}
                        size="mini"
                      />
                    </div>
                    <div className="text-center space-y-0.5">
                      <p className={`text-[9px] font-semibold ${isMySlot ? "text-[#238D9D]" : "text-slate-500"}`}>
                        #{slot.number}{isMySlot ? " (You)" : ""}
                      </p>
                      {slot.player && (
                        <p className="text-[8px] text-slate-400 truncate">
                          {shortAddress(slot.player)}
                        </p>
                      )}
                      {!slot.player && (
                        <p className="text-[8px] text-slate-300">Empty</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <Dice3D value={diceResult} rolling={isRolling} />
          )}
        </div>

        {/* Result text */}
        <div className="relative z-10 text-center space-y-1">
          {isRolling && (
            <p className="text-sm text-slate-700">
              The Akiba dice is spinning… watch for the number it lands on.
            </p>
          )}

          {!isRolling && diceResult !== null && (
            <>
              <p className="text-sm text-slate-800">
                Winning number:{" "}
                <span className="font-semibold text-[#238D9D]">{diceResult}</span>
              </p>

              {selectedNumber != null && (
                <p className="text-xs text-slate-500">
                  You picked{" "}
                  <span className="font-semibold text-slate-800">#{selectedNumber}</span>.
                </p>
              )}

              {userWon && (
                <p className="text-sm text-[#238D9D] font-medium mt-1">
                  You take the whole pot 🎉
                </p>
              )}

              {userLost && (
                <p className="text-sm text-rose-600 font-medium mt-1">
                  You didn't win this pot, but the next round is yours to grab.
                </p>
              )}

              {!userWon && lastResultMessage && (
                <p className="text-sm text-slate-700 mt-1">{lastResultMessage}</p>
              )}
            </>
          )}

          {!isRolling && diceResult === null && (
            <p className="text-sm text-slate-600">Waiting for the result of this pot.</p>
          )}
        </div>

        {/* Actions */}
        {!isRolling && (
          <div className="relative z-10 flex flex-col gap-2 pt-2">
            <button
              onClick={onClose}
              className="w-full rounded-full bg-gradient-to-r from-[#238D9D] to-[#1a7080] text-white text-sm font-medium py-2.5 hover:brightness-110 shadow-md shadow-[#238D9D]/30"
            >
              Close
            </button>
            <p className="text-[11px] text-slate-500 text-center">
              Jump back into{" "}
              <span className="font-medium text-slate-700">Six-Sided Pot</span>{" "}
              and pick a new number in the next round.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
