// components/dice/WinnerToast.tsx
"use client";

import { useEffect, useState } from "react";
import { shortAddress } from "@/lib/diceTypes";

type Props = {
  roundId: bigint;
  winningNumber: number;
  winner: string;
  potLabel: string;
  iWon: boolean;
  onClose: () => void;
};

export function WinnerToast({ roundId, winningNumber, winner, potLabel, iWon, onClose }: Props) {
  const [visible, setVisible] = useState(false);

  // Slide in after mount
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 300); // wait for slide-out
  }

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-10 opacity-0"
      }`}
    >
      <div className={`rounded-2xl border shadow-xl px-4 py-3 flex items-start gap-3 ${
        iWon
          ? "bg-emerald-500 border-emerald-600 text-white shadow-emerald-300"
          : "bg-white border-slate-200 text-slate-900 shadow-slate-200"
      }`}>
        <span className="text-2xl flex-shrink-0 mt-0.5">{iWon ? "🎉" : "🏆"}</span>

        <div className="flex-1 min-w-0">
          <p className={`text-[11px] font-bold uppercase tracking-wide ${iWon ? "text-emerald-100" : "text-slate-500"}`}>
            Round #{roundId.toString()} complete
          </p>
          <p className={`text-[14px] font-semibold ${iWon ? "text-white" : "text-slate-900"}`}>
            {iWon ? "You won!" : `Number #${winningNumber} wins`}
          </p>
          <p className={`text-[11px] mt-0.5 ${iWon ? "text-emerald-100" : "text-slate-500"}`}>
            {iWon ? potLabel : `${shortAddress(winner)} · ${potLabel}`}
          </p>
        </div>

        <button
          onClick={handleClose}
          className={`flex-shrink-0 text-[13px] leading-none mt-0.5 transition ${
            iWon ? "text-emerald-100 hover:text-white" : "text-slate-400 hover:text-slate-700"
          }`}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
