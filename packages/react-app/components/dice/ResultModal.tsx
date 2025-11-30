// components/dice/ResultModal.tsx
"use client";

import Image from "next/image";
import { Dice3D } from "./Dice3D";
import { akibaMilesSymbol } from "@/lib/svg";

export type ResultModalProps = {
  open: boolean;
  onClose: () => void;
  diceResult: number | null;
  isRolling: boolean;
  lastResultMessage: string | null;
  selectedNumber: number | null;
  potSize: number;
};

export function ResultModal({
  open,
  onClose,
  diceResult,
  isRolling,
  lastResultMessage,
  selectedNumber,
  potSize,
}: ResultModalProps) {
  if (!open) return null;

  const userWon =
    !isRolling && diceResult !== null && selectedNumber === diceResult;
  const userLost =
    !isRolling &&
    diceResult !== null &&
    selectedNumber != null &&
    selectedNumber !== diceResult;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 rounded-3xl bg-white shadow-2xl border border-slate-200 p-5 space-y-4 relative overflow-hidden">
        {/* Accent gradient halo */}
        <div className="pointer-events-none absolute -top-24 -right-24 h-48 w-48 rounded-full bg-emerald-300/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-24 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl" />

        {/* Header */}
        <div className="flex items-start justify-between gap-3 relative z-10">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 border border-emerald-100">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              <span className="text-[10px] font-medium text-emerald-700 tracking-wide uppercase">
                Akiba Dice
              </span>
            </div>
            <h2 className="text-base font-semibold text-slate-900">
              {isRolling
                ? "Rolling the dice…"
                : userWon
                ? "You won the pot!"
                : userLost
                ? "You didn’t win this pot"
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
            <div className="h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center shadow">
              <Image
                src={akibaMilesSymbol}
                alt="Akiba"
                className="h-3 w-3"
              />
            </div>
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] uppercase tracking-wide text-slate-300">
                Pot value
              </span>
              <span className="text-xs font-semibold inline-flex items-center gap-1">
                <Image
                  src={akibaMilesSymbol}
                  alt="Akiba"
                  className="h-3 w-3"
                />
                {potSize.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Dice */}
        <div className="relative z-10">
          <Dice3D value={diceResult} rolling={isRolling} />
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
                <span className="font-semibold text-emerald-600">
                  {diceResult}
                </span>
              </p>

              {selectedNumber != null && (
                <p className="text-xs text-slate-500">
                  You picked{" "}
                  <span className="font-semibold text-slate-800">
                    #{selectedNumber}
                  </span>
                  .
                </p>
              )}

              {userWon && (
                <p className="text-sm text-emerald-700 font-medium mt-1">
                  You take the whole pot 🎉
                </p>
              )}

              {userLost && (
                <p className="text-sm text-rose-600 font-medium mt-1">
                  You didn’t win this pot, but the next round is yours to grab.
                </p>
              )}

              {!userWon && lastResultMessage && (
                <p className="text-sm text-slate-700 mt-1">
                  {lastResultMessage}
                </p>
              )}
            </>
          )}

          {!isRolling && diceResult === null && (
            <p className="text-sm text-slate-600">
              Waiting for the result of this pot.
            </p>
          )}
        </div>

        {/* Actions */}
        {!isRolling && (
          <div className="relative z-10 flex flex-col gap-2 pt-2">
            <button
              onClick={onClose}
              className="w-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 text-white text-sm font-medium py-2.5 hover:brightness-110 shadow-md shadow-emerald-200"
            >
              Close
            </button>
            <p className="text-[11px] text-slate-500 text-center">
              Jump back into{" "}
              <span className="font-medium text-slate-700">
                Six-Sided Pot
              </span>{" "}
              and pick a new number in the next round.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
