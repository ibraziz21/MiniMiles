"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type ThemeConfig } from "@/lib/crackpotTypes";

type SymbolPickerProps = {
  theme: ThemeConfig;
  symbolOrder: number[];
  selectedSlot: number | null;
  currentGuess: (number | null)[];
  onSelect: (symbolIndex: number) => void;
  disabled: boolean;
};

export function SymbolPicker({
  theme,
  symbolOrder,
  selectedSlot,
  currentGuess,
  onSelect,
  disabled,
}: SymbolPickerProps) {
  const [lastTapped, setLastTapped] = useState<number | null>(null);

  function handleTap(idx: number) {
    if (selectedSlot === null || disabled) return;
    setLastTapped(idx);
    onSelect(idx);
    // Clear the burst key after animation duration
    setTimeout(() => setLastTapped((prev) => (prev === idx ? null : prev)), 350);
  }

  const isPickable = selectedSlot !== null && !disabled;

  // Count how many times each symbol index appears in the current guess
  const useCounts = new Map<number, number>();
  currentGuess.forEach((s) => {
    if (s !== null) useCounts.set(s, (useCounts.get(s) ?? 0) + 1);
  });

  return (
    <div className="w-full">
      {/* Instruction */}
      <p className="text-xs text-slate-400 text-center mb-2 h-4">
        {selectedSlot !== null
          ? `Position ${selectedSlot + 1} — pick a symbol`
          : disabled
          ? ""
          : "Tap a slot above to select a position"}
      </p>

      <div className="grid grid-cols-6 gap-2">
        {symbolOrder.map((idx) => {
          const useCount = useCounts.get(idx) ?? 0;
          // Only fully dim when ALL 4 slots use this symbol (impossible to add more)
          const isExhausted = useCount >= 4;
          const isInUse = useCount > 0;
          const isTapped = lastTapped === idx;

          return (
            <div key={idx} className="relative">
              {/* Burst ring */}
              <AnimatePresence>
                {isTapped && (
                  <motion.div
                    key="burst"
                    className="absolute inset-0 rounded-xl pointer-events-none"
                    initial={{ opacity: 0.7, scale: 1 }}
                    animate={{ opacity: 0, scale: 1.55 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.32, ease: "easeOut" }}
                    style={{ backgroundColor: theme.accentColor }}
                  />
                )}
              </AnimatePresence>

              <motion.button
                onClick={() => handleTap(idx)}
                disabled={disabled || selectedSlot === null || isExhausted}
                whileTap={isPickable && !isExhausted ? { scale: 0.88 } : {}}
                animate={
                  isTapped
                    ? { scale: [1, 1.18, 1], backgroundColor: `${theme.accentColor}22` }
                    : { scale: 1, backgroundColor: "#ffffff" }
                }
                transition={{ duration: 0.22, ease: "backOut" }}
                className={[
                  "relative w-full flex flex-col items-center justify-center gap-0.5 rounded-xl p-2 border-2 transition-colors",
                  isPickable && !isExhausted ? "cursor-pointer" : "cursor-default",
                  isExhausted ? "opacity-30" : "",
                ].join(" ")}
                style={{
                  borderColor: isTapped
                    ? theme.accentColor
                    : isPickable && !isExhausted
                    ? theme.accentColor
                    : isInUse
                    ? `${theme.accentColor}60`  // subtle tint when in use but not exhausted
                    : "transparent",
                  boxShadow: isTapped
                    ? `0 0 0 3px ${theme.accentColor}40`
                    : isPickable && !isExhausted
                    ? "0 1px 4px rgba(0,0,0,0.08)"
                    : "none",
                }}
              >
                <motion.span
                  className="text-2xl leading-none select-none"
                  animate={isTapped ? { y: [-3, 0] } : { y: 0 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                >
                  {theme.symbols[idx]}
                </motion.span>
                <span className="text-[9px] text-slate-500 font-medium truncate max-w-full">
                  {theme.symbolLabels[idx]}
                </span>

                {/* Use-count badge — shows ×2, ×3, ×4 when repeated */}
                {useCount >= 2 && (
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black text-white"
                    style={{ backgroundColor: theme.accentColor }}
                  >
                    ×{useCount}
                  </motion.div>
                )}

                {/* Single-use dot — subtle indicator when used once */}
                {useCount === 1 && (
                  <div
                    className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border-2 border-white"
                    style={{ backgroundColor: theme.accentColor }}
                  />
                )}
              </motion.button>
            </div>
          );
        })}
      </div>

      {/* Repeat hint — shown when any symbol is used more than once */}
      {[...useCounts.values()].some((c) => c > 1) && (
        <p className="text-[10px] text-center mt-1.5" style={{ color: theme.accentColor }}>
          Symbols can repeat — keep going
        </p>
      )}
    </div>
  );
}
