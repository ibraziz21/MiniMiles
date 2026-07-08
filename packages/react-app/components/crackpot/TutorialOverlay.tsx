"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type ThemeConfig } from "@/lib/crackpotTypes";

const STORAGE_KEY = "crackpot_tutorial_seen_v1";

function storageKeyForUser(userAddress?: string | null) {
  if (!userAddress) return null;
  return `${STORAGE_KEY}:${userAddress.toLowerCase()}`;
}

export function useTutorialSeen(userAddress?: string | null): [boolean, () => void] {
  // Start as "seen" to avoid flash on SSR/hydration; set real value after mount
  const [seen, setSeen] = useState(true);

  useEffect(() => {
    const key = storageKeyForUser(userAddress);
    setSeen(key ? !!localStorage.getItem(key) : true);
  }, [userAddress]);

  function markSeen() {
    const key = storageKeyForUser(userAddress);
    if (key) localStorage.setItem(key, "1");
    setSeen(true);
  }
  return [seen, markSeen];
}

type Step = {
  emoji: string;
  title: string;
  body: React.ReactNode;
};

function buildSteps(theme: ThemeConfig): Step[] {
  const [s1, s2, s3, s4] = theme.symbols;
  const [l1, l2, l3, l4] = theme.symbolLabels;

  return [
    {
      emoji: "🎯",
      title: "Crack the 4-symbol code",
      body: (
        <>
          A secret 4-symbol sequence is hidden on the server.{" "}
          <span className="font-semibold text-slate-800">
            First player to guess it wins the entire pot.
          </span>{" "}
          You have 60 seconds per attempt.
        </>
      ),
    },
    {
      emoji: "🔎",
      title: "Read your feedback",
      body: (
        <div className="space-y-2.5 text-left">
          <p className="text-slate-500 text-sm">After each guess you get one of three signals per position:</p>
          <div className="space-y-2">
            {[
              { dot: "bg-yellow-400 border-yellow-500 text-yellow-900", icon: "✓", label: "Locked", desc: "Right symbol, right position. Always truthful." },
              { dot: "bg-amber-200 border-amber-400 text-amber-800", icon: "~", label: "Close", desc: "Right symbol, wrong position." },
              { dot: "bg-slate-100 border-slate-300 text-slate-400", icon: "✕", label: "Miss", desc: "Symbol not in this position." },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold shrink-0 ${item.dot}`}>
                  {item.icon}
                </div>
                <span className="text-sm text-slate-600">
                  <span className="font-semibold text-slate-800">{item.label}</span> — {item.desc}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Tip: Miles feedback can include small Close/Miss noise. USDT feedback is exact.
          </p>
        </div>
      ),
    },
    {
      emoji: "⚡",
      title: "Strategy beats luck",
      body: (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            A skilled player cracks most codes in{" "}
            <span className="font-semibold text-slate-800">4–5 guesses</span>.
            Start by testing all 4 positions with the same symbol.
          </p>
          {/* Example deduction row */}
          <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Example first guess</p>
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr] gap-2 text-center">
              {[s1, s1, s1, s1].map((sym, i) => (
                <div key={i} className="flex flex-col items-center gap-1">
                  <span className="text-xl">{sym}</span>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-[9px] font-bold ${
                    i === 0 ? "bg-yellow-400 border-yellow-500 text-yellow-900" : "bg-slate-100 border-slate-300 text-slate-400"
                  }`}>
                    {i === 0 ? "✓" : "✕"}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-2">
              → <span className="font-medium text-slate-600">{l1}</span> is in position 1 only. Move on to test other symbols.
            </p>
          </div>
          <p className="text-xs text-slate-400">
            Each paid entry gives you 60 seconds and 2 guesses.
          </p>
        </div>
      ),
    },
  ];
}

type TutorialOverlayProps = {
  theme: ThemeConfig;
  onDismiss: () => void;
};

export function TutorialOverlay({ theme, onDismiss }: TutorialOverlayProps) {
  const [step, setStep] = useState(0);
  const steps = buildSteps(theme);
  const isLast = step === steps.length - 1;
  const current = steps[step];

  function next() {
    if (isLast) { onDismiss(); return; }
    setStep((s) => s + 1);
  }

  function skip() { onDismiss(); }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(0,0,0,0.65)" }}
    >
      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="w-full max-w-md bg-white rounded-t-3xl pb-10 shadow-2xl overflow-hidden"
      >
        {/* Progress bar */}
        <div className="h-1 bg-slate-100">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: theme.accentColor }}
            animate={{ width: `${((step + 1) / steps.length) * 100}%` }}
            transition={{ duration: 0.3 }}
          />
        </div>

        <div className="p-6">
          {/* Step counter + skip */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <div
                  key={i}
                  className="h-1.5 rounded-full transition-all duration-300"
                  style={{
                    width: i === step ? 20 : 8,
                    backgroundColor: i <= step ? theme.accentColor : "#e2e8f0",
                  }}
                />
              ))}
            </div>
            <button
              onClick={skip}
              className="text-xs text-slate-400 font-medium hover:text-slate-600 transition-colors"
            >
              Skip
            </button>
          </div>

          {/* Step content */}
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -24 }}
              transition={{ duration: 0.2 }}
            >
              <div className="text-4xl mb-3">{current.emoji}</div>
              <h3 className="text-xl font-black text-slate-900 mb-3">{current.title}</h3>
              <div className="text-sm text-slate-500 leading-relaxed">{current.body}</div>
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="flex gap-3 mt-6">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => s - 1)}
                className="flex-1 py-3 rounded-2xl font-semibold text-sm bg-slate-100 text-slate-600 active:scale-[0.98] transition-all"
              >
                ← Back
              </button>
            )}
            <motion.button
              onClick={next}
              whileTap={{ scale: 0.97 }}
              className="flex-1 py-3 rounded-2xl font-bold text-sm text-white shadow-md active:scale-[0.98] transition-all"
              style={{ backgroundColor: theme.accentColor }}
            >
              {isLast ? "Let's Play →" : "Next →"}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
