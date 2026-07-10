"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type GuessView, type FeedbackResult, type ThemeConfig, CRACKPOT_PEGS } from "@/lib/crackpotTypes";

type GuessFeedbackProps = {
  guesses: GuessView[];
  theme: ThemeConfig;
  newGuessNumber?: number;
};

const FEEDBACK_CONFIG: Record<FeedbackResult, { bg: string; border: string; icon: string; label: string; textColor: string }> = {
  locked: { bg: "bg-yellow-400",  border: "border-yellow-500", icon: "✓", label: "Locked", textColor: "text-yellow-900" },
  close:  { bg: "bg-amber-200",   border: "border-amber-400",  icon: "~", label: "Close",  textColor: "text-amber-800" },
  miss:   { bg: "bg-slate-100",   border: "border-slate-300",  icon: "✕", label: "Miss",   textColor: "text-slate-400" },
};

function FeedbackDot({ result, delay = 0, animate: shouldAnimate = false }: {
  result: FeedbackResult; delay?: number; animate?: boolean;
}) {
  const cfg = FEEDBACK_CONFIG[result];
  if (!shouldAnimate) {
    return (
      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[9px] font-bold ${cfg.bg} ${cfg.border} ${cfg.textColor}`}>
        {cfg.icon}
      </div>
    );
  }
  return (
    <motion.div
      className={`w-4 h-4 rounded-full border-2 flex items-center justify-center text-[9px] font-bold ${cfg.bg} ${cfg.border} ${cfg.textColor}`}
      initial={{ rotateY: 90, scale: 0.5, opacity: 0 }}
      animate={{ rotateY: 0, scale: 1, opacity: 1 }}
      transition={{ delay, duration: 0.25, ease: "backOut" }}
    >
      {cfg.icon}
    </motion.div>
  );
}

function GuessRow({ guess, theme, isNew, colIndex }: {
  guess: GuessView; theme: ThemeConfig; isNew: boolean; colIndex: number;
}) {
  const [revealed, setRevealed] = useState(!isNew);

  useEffect(() => {
    if (!isNew) return;
    const t = setTimeout(() => setRevealed(true), 80);
    return () => clearTimeout(t);
  }, [isNew]);

  const lockedCount = guess.feedback.filter((f) => f === "locked").length;
  const rowBg = guess.isCorrect
    ? "bg-yellow-50 border-yellow-300"
    : lockedCount >= CRACKPOT_PEGS - 1
    ? "bg-amber-50/50 border-amber-200"
    : "bg-white border-slate-100";

  return (
    <motion.div
      initial={isNew ? { opacity: 0, x: -6 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      style={{ gridTemplateColumns: `20px repeat(${CRACKPOT_PEGS}, 1fr) 28px` }}
      className={`grid items-center gap-1.5 px-2 py-2 rounded-xl border ${rowBg}`}
    >
      {/* Row number */}
      <span className="text-[10px] font-bold text-slate-300 text-center">#{guess.guessNumber}</span>

      {/* CRACKPOT_PEGS symbol+dot columns */}
      {guess.symbols.map((idx, pos) => (
        <div key={pos} className="flex flex-col items-center gap-1">
          <motion.span
            className="text-lg leading-none"
            initial={isNew ? { scale: 0.6, opacity: 0 } : false}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: pos * 0.04, duration: 0.16, ease: "backOut" }}
          >
            {theme.symbols[idx]}
          </motion.span>
          {revealed ? (
            <FeedbackDot
              result={guess.feedback[pos]}
              delay={isNew ? pos * 0.1 : 0}
              animate={isNew}
            />
          ) : (
            <div className="w-4 h-4 rounded-full bg-slate-100 border-2 border-slate-200 animate-pulse" />
          )}
        </div>
      ))}

      {/* Locked badge */}
      <div className={`text-center text-[10px] font-bold leading-tight ${
        lockedCount === CRACKPOT_PEGS ? "text-yellow-600" : lockedCount >= CRACKPOT_PEGS - 1 ? "text-amber-500" : "text-slate-300"
      }`}>
        {lockedCount}/{CRACKPOT_PEGS}
      </div>
    </motion.div>
  );
}

// Column headers — aligned to the grid
function GridHeader({ theme }: { theme: ThemeConfig }) {
  return (
    <div
      style={{ gridTemplateColumns: `20px repeat(${CRACKPOT_PEGS}, 1fr) 28px` }}
      className="grid items-center gap-1.5 px-2 mb-0.5"
    >
      <span />
      {Array.from({ length: CRACKPOT_PEGS }, (_, pos) => (
        <span key={pos} className="text-[9px] text-slate-300 text-center font-medium uppercase tracking-wide">
          P{pos + 1}
        </span>
      ))}
      <span />
    </div>
  );
}

export function GuessFeedback({ guesses, theme, newGuessNumber }: GuessFeedbackProps) {
  if (guesses.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Guesses ({guesses.length})
        </p>
        {/* Legend — compact inline */}
        <div className="flex gap-2">
          {(["locked", "close", "miss"] as FeedbackResult[]).map((r) => (
            <div key={r} className="flex items-center gap-0.5">
              <FeedbackDot result={r} />
              <span className="text-[9px] text-slate-400">{FEEDBACK_CONFIG[r].label}</span>
            </div>
          ))}
        </div>
      </div>

      <GridHeader theme={theme} />

      <AnimatePresence initial={false}>
        {[...guesses].reverse().map((g, i) => (
          <GuessRow
            key={g.guessNumber}
            guess={g}
            theme={theme}
            isNew={g.guessNumber === newGuessNumber}
            colIndex={i}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}
