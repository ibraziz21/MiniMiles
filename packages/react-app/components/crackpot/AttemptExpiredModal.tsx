"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { type GuessView, type ThemeConfig } from "@/lib/crackpotTypes";

type AttemptExpiredModalProps = {
  guesses: GuessView[];
  theme: ThemeConfig;
  freeAttemptsLeft: number;
  retryLabel?: string;
  onTryAgain: () => void;
  onDismiss: () => void;
};

const FEEDBACK_BG: Record<string, string> = {
  locked: "bg-yellow-400 border-yellow-500 text-yellow-900",
  close:  "bg-amber-200 border-amber-400 text-amber-800",
  miss:   "bg-slate-100 border-slate-300 text-slate-400",
};
const FEEDBACK_ICON: Record<string, string> = { locked: "✓", close: "~", miss: "✕" };

export function AttemptExpiredModal({
  guesses, theme, freeAttemptsLeft, retryLabel, onTryAgain, onDismiss,
}: AttemptExpiredModalProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 30);
    return () => clearTimeout(t);
  }, []);

  // Best guess = highest locked count
  const bestGuess = guesses.length > 0
    ? guesses.reduce((best, g) =>
        g.feedback.filter((f) => f === "locked").length >
        best.feedback.filter((f) => f === "locked").length ? g : best,
      guesses[0])
    : null;
  const bestLocked = bestGuess ? bestGuess.feedback.filter((f) => f === "locked").length : 0;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-end justify-center transition-all duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onDismiss}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        className="w-full max-w-md bg-white rounded-t-3xl p-6 pb-10 shadow-2xl"
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-5" />

        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="text-4xl">⏱️</div>
          <div>
            <h3 className="text-lg font-black text-slate-900">Attempt ended</h3>
            <p className="text-sm text-slate-500">
              {guesses.length === 0
                ? "No guesses submitted this attempt."
                : `You made ${guesses.length} guess${guesses.length > 1 ? "es" : ""}.`}
            </p>
          </div>
        </div>

        {/* Best guess row */}
        {bestGuess && (
          <div className="mb-4">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Your best guess — {bestLocked}/4 locked
            </p>
            <div className="flex items-center gap-2 p-3 rounded-2xl bg-slate-50 border border-slate-100">
              {bestGuess.symbols.map((idx, pos) => (
                <div key={pos} className="flex flex-col items-center gap-1 flex-1">
                  <span className="text-2xl leading-none">{theme.symbols[idx]}</span>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold ${FEEDBACK_BG[bestGuess.feedback[pos]]}`}>
                    {FEEDBACK_ICON[bestGuess.feedback[pos]]}
                  </div>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-yellow-400 transition-all"
                style={{ width: `${(bestLocked / 4) * 100}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-1 text-right">
              {bestLocked === 3 ? "So close! One more position to find." :
               bestLocked === 2 ? "Halfway there — keep deducing." :
               bestLocked <= 1 ? "Use each guess to eliminate symbols." : ""}
            </p>
          </div>
        )}

        {/* CTA */}
        {freeAttemptsLeft > 0 ? (
          <button
            onClick={onTryAgain}
            className="w-full py-4 rounded-2xl font-bold text-white text-sm shadow-lg active:scale-[0.98] transition-all"
            style={{ backgroundColor: theme.accentColor }}
          >
            Try Again — {freeAttemptsLeft} free attempt{freeAttemptsLeft > 1 ? "s" : ""} left
          </button>
        ) : (
          <div className="space-y-2">
            <button
              onClick={onTryAgain}
              className="w-full py-4 rounded-2xl font-bold text-white text-sm active:scale-[0.98] transition-all"
              style={{ backgroundColor: theme.accentColor }}
            >
              {retryLabel ?? "Unlock more attempts"}
            </button>
            <button
              onClick={onDismiss}
              className="w-full py-3 rounded-2xl font-semibold text-slate-500 text-sm bg-slate-100 active:scale-[0.98]"
            >
              Wait for next cycle
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
