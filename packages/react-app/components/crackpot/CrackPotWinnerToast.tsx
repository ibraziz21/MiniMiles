"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type CrackPotVersion } from "@/lib/crackpotTypes";
import { TokenAmount } from "./TokenAmount";

type WinnerInfo = {
  address: string;   // already shortened
  guesses: number;
  potBalance: number;
};

type CrackPotWinnerToastProps = {
  winner: WinnerInfo;
  version: CrackPotVersion;
  iWon: boolean;
  onClose: () => void;
};

export function CrackPotWinnerToast({ winner, version, iWon, onClose }: CrackPotWinnerToastProps) {
  const [visible, setVisible] = useState(false);
  const isUsdt = version === "usdt";

  useEffect(() => {
    const show = setTimeout(() => setVisible(true), 80);
    const hide = setTimeout(() => { setVisible(false); setTimeout(onClose, 400); }, 7000);
    return () => { clearTimeout(show); clearTimeout(hide); };
  }, [onClose]);

  const displayAmount = isUsdt
    ? `$${(winner.potBalance / 100).toFixed(2)}`
    : winner.potBalance.toLocaleString();

  const skillLabel =
    winner.guesses <= 3 ? "Expert solve 🧠" :
    winner.guesses <= 5 ? "Skilled play ⚡" : "Cracked it 🎯";

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: -80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -80, opacity: 0 }}
          transition={{ type: "spring", damping: 22, stiffness: 280 }}
          className="fixed top-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm"
        >
          <div
            className={`rounded-2xl px-4 py-3 shadow-2xl flex items-center gap-3 ${
              iWon
                ? "bg-yellow-400 text-yellow-900"
                : "bg-slate-900 text-white"
            }`}
          >
            {/* Icon */}
            <span className="text-2xl shrink-0">{iWon ? "🏆" : "💥"}</span>

            {/* Text */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold leading-tight truncate">
                {iWon ? "You cracked it!" : `${winner.address} cracked it!`}
              </p>
              <p className="text-xs opacity-70 flex items-center gap-1 flex-wrap mt-0.5">
                Won <TokenAmount amount={displayAmount} isUsdt={isUsdt} symbolSize={11} textClass="font-semibold" gap="gap-0.5" />
                · {winner.guesses} guess{winner.guesses !== 1 ? "es" : ""}
                · {skillLabel}
              </p>
            </div>

            {/* Dismiss */}
            <button
              onClick={() => { setVisible(false); setTimeout(onClose, 400); }}
              className="shrink-0 opacity-60 hover:opacity-100 transition-opacity text-lg leading-none"
            >
              ×
            </button>
          </div>

          {/* Progress bar — auto-dismiss indicator */}
          <motion.div
            className={`h-0.5 rounded-full mt-1 mx-1 ${iWon ? "bg-yellow-500" : "bg-white/30"}`}
            initial={{ scaleX: 1 }}
            animate={{ scaleX: 0 }}
            transition={{ duration: 7, ease: "linear" }}
            style={{ transformOrigin: "left" }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
