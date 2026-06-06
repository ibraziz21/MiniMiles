"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type ThemeConfig } from "@/lib/crackpotTypes";
import { SymbolPicker } from "./SymbolPicker";

type GuessBoardProps = {
  theme: ThemeConfig;
  symbolOrder: number[];
  onSubmit: (symbols: [number, number, number, number]) => void;
  isSubmitting: boolean;
  cooldownSeconds: number;
  disabled: boolean;
};

// SVG cooldown ring — draws an arc that drains over COOLDOWN_TOTAL seconds
const COOLDOWN_TOTAL = 15;
const R = 22; // radius
const CIRCUMFERENCE = 2 * Math.PI * R;

function CooldownRing({ seconds }: { seconds: number }) {
  const progress = seconds / COOLDOWN_TOTAL;
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 56 56">
      {/* Track */}
      <circle cx="28" cy="28" r={R} fill="none" stroke="#e2e8f0" strokeWidth="3" />
      {/* Progress arc */}
      <motion.circle
        cx="28" cy="28" r={R}
        fill="none"
        stroke="#f59e0b"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        transition={{ duration: 1, ease: "linear" }}
      />
    </svg>
  );
}

export function GuessBoard({
  theme,
  symbolOrder,
  onSubmit,
  isSubmitting,
  cooldownSeconds,
  disabled,
}: GuessBoardProps) {
  const [slots, setSlots] = useState<(number | null)[]>([null, null, null, null]);
  const [activeSlot, setActiveSlot] = useState<number | null>(0);
  const prevSlotsRef = useRef<(number | null)[]>([null, null, null, null]);

  const allFilled = slots.every((s) => s !== null);
  const inCooldown = cooldownSeconds > 0;
  const canSubmit = allFilled && !isSubmitting && !disabled && !inCooldown;

  // Reset board when a new attempt starts (all slots null coming from disabled→enabled)
  useEffect(() => {
    if (!disabled) {
      setSlots([null, null, null, null]);
      setActiveSlot(0);
    }
  }, [disabled]);

  function handleSlotClick(slotIndex: number) {
    if (disabled || inCooldown) return;
    setActiveSlot(slotIndex);
  }

  function handleSymbolSelect(symbolIndex: number) {
    if (activeSlot === null || disabled || inCooldown) return;
    const next = [...slots];
    next[activeSlot] = symbolIndex;
    setSlots(next);
    // Advance to next empty slot
    const nextEmpty = next.findIndex((s, i) => i > activeSlot && s === null);
    setActiveSlot(nextEmpty === -1 ? null : nextEmpty);
    prevSlotsRef.current = next;
  }

  function handleClear(slotIndex: number) {
    if (disabled || inCooldown) return;
    const next = [...slots];
    next[slotIndex] = null;
    setSlots(next);
    setActiveSlot(slotIndex);
  }

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(slots as [number, number, number, number]);
    setSlots([null, null, null, null]);
    setActiveSlot(0);
  }

  // ── Keyboard support ─────────────────────────────────────────
  // 1–6     → select symbol by position in symbolOrder
  // Tab / → → advance active slot right
  // ←       → move active slot left
  // Backspace / Delete → clear active slot
  // Enter   → submit if all filled
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (disabled || inCooldown) return;
    // Don't intercept when user is typing in an input elsewhere
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    const key = e.key;

    if (key === "Enter") {
      e.preventDefault();
      handleSubmit();
      return;
    }

    if (key === "Backspace" || key === "Delete") {
      e.preventDefault();
      // Clear current active slot, or last filled slot if active is already empty
      const target = activeSlot !== null && slots[activeSlot] !== null
        ? activeSlot
        : [...slots].reverse().findIndex((s) => s !== null);
      const actualTarget = activeSlot !== null && slots[activeSlot] !== null
        ? activeSlot
        : slots.length - 1 - [...slots].reverse().findIndex((s) => s !== null);
      if (slots.some((s) => s !== null)) {
        const clearIdx = activeSlot !== null ? activeSlot : actualTarget;
        handleClear(clearIdx);
      }
      return;
    }

    if (key === "Tab" || key === "ArrowRight") {
      e.preventDefault();
      setActiveSlot((prev) => (prev === null ? 0 : Math.min(3, prev + 1)));
      return;
    }

    if (key === "ArrowLeft") {
      e.preventDefault();
      setActiveSlot((prev) => (prev === null ? 3 : Math.max(0, prev - 1)));
      return;
    }

    // 1–6 → pick symbol at that rank in symbolOrder
    const num = parseInt(key, 10);
    if (num >= 1 && num <= 6 && activeSlot !== null) {
      e.preventDefault();
      const symbolIndex = symbolOrder[num - 1];
      if (symbolIndex !== undefined) handleSymbolSelect(symbolIndex);
      return;
    }
  }, [disabled, inCooldown, activeSlot, slots, symbolOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Determine button state
  const buttonState = isSubmitting ? "submitting"
    : inCooldown ? "cooldown"
    : disabled ? "disabled"
    : allFilled ? "ready"
    : "filling";

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* 4 symbol slots */}
      <div className="flex gap-2 justify-center">
        {slots.map((sym, i) => {
          const isActive = activeSlot === i;
          const isFilled = sym !== null;

          return (
            <motion.button
              key={i}
              onClick={() => isFilled ? handleClear(i) : handleSlotClick(i)}
              whileTap={!disabled ? { scale: 0.93 } : {}}
              animate={
                allFilled && !inCooldown
                  ? { boxShadow: `0 0 0 2px ${theme.accentColor}` }
                  : isActive
                  ? { scale: 1.06 }
                  : { scale: 1, boxShadow: "none" }
              }
              transition={{ duration: 0.15 }}
              className={[
                "w-16 h-16 rounded-2xl border-2 flex flex-col items-center justify-center relative",
                isFilled ? "bg-white shadow-md" : "bg-slate-50",
                disabled || inCooldown ? "opacity-60 cursor-not-allowed" : "cursor-pointer",
              ].join(" ")}
              style={{
                borderColor: allFilled && !inCooldown
                  ? theme.accentColor
                  : isActive
                  ? theme.accentColor
                  : isFilled
                  ? "#94a3b8"
                  : "#e2e8f0",
              }}
            >
              <AnimatePresence mode="wait">
                {sym !== null ? (
                  <motion.div
                    key={sym}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ duration: 0.15, ease: "backOut" }}
                    className="flex flex-col items-center"
                  >
                    <span className="text-3xl leading-none">{theme.symbols[sym]}</span>
                    <span className="text-[9px] text-slate-400 mt-0.5">{theme.symbolLabels[sym]}</span>
                  </motion.div>
                ) : (
                  <motion.span
                    key="empty"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="text-slate-300 text-xl font-light"
                  >
                    {i + 1}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          );
        })}
      </div>

      {/* Symbol picker */}
      <SymbolPicker
        theme={theme}
        symbolOrder={symbolOrder}
        selectedSlot={activeSlot}
        currentGuess={slots}
        onSelect={handleSymbolSelect}
        disabled={disabled || inCooldown}
      />

      {/* Keyboard hint — only on non-touch devices */}
      <p className="hidden sm:block text-center text-[10px] text-slate-300 -mt-2">
        Keys 1–6 pick symbols · ← → move slot · Backspace clears · Enter submits
      </p>

      {/* Submit button with cooldown ring */}
      <motion.button
        onClick={handleSubmit}
        disabled={!canSubmit}
        whileTap={canSubmit ? { scale: 0.97 } : {}}
        className={[
          "w-full py-3.5 rounded-2xl font-bold text-sm relative overflow-hidden transition-colors",
          buttonState === "ready" ? "text-white shadow-lg" : "cursor-not-allowed",
          buttonState === "cooldown" ? "bg-white border-2 border-slate-200 text-slate-600" : "",
          buttonState === "disabled" || buttonState === "filling" ? "bg-slate-100 text-slate-400" : "",
          buttonState === "submitting" ? "text-white opacity-80" : "",
        ].join(" ")}
        style={
          buttonState === "ready" || buttonState === "submitting"
            ? { backgroundColor: theme.accentColor }
            : {}
        }
      >
        {buttonState === "cooldown" ? (
          <span className="flex items-center justify-center gap-2">
            <span className="relative w-7 h-7 shrink-0">
              <CooldownRing seconds={cooldownSeconds} />
              <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-amber-600">
                {cooldownSeconds}
              </span>
            </span>
            Next guess ready soon
          </span>
        ) : buttonState === "submitting" ? (
          <span className="flex items-center justify-center gap-2">
            <motion.span
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
              className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"
            />
            Checking…
          </span>
        ) : buttonState === "ready" ? (
          "Submit Guess →"
        ) : (
          "Fill all 4 positions"
        )}
      </motion.button>
    </div>
  );
}
