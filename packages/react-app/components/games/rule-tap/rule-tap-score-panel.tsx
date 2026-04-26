"use client";

import { useEffect, useRef, useState } from "react";

export function RuleTapScorePanel({
  score,
  mistakes,
  remainingMs,
  combo,
  lastDelta,
}: {
  score: number;
  mistakes: number;
  remainingMs: number;
  combo: number;
  lastDelta: number | null;
}) {
  const totalMs = 20_000;
  const pct = Math.max(0, remainingMs / totalMs);
  const seconds = Math.ceil(remainingMs / 1000);
  const isLow = seconds <= 5;
  const timerColor = isLow ? "bg-red-400" : seconds <= 10 ? "bg-yellow-400" : "bg-[#4EFFA0]";

  // Float the delta label briefly
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (lastDelta === null) return;
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 700);
  }, [lastDelta]);

  return (
    <div className="mx-4 space-y-2">
      {/* Timer bar */}
      <div className="h-2 w-full rounded-full bg-white/20 overflow-hidden bg-[#E8F5F0]">
        <div
          className={`h-full rounded-full transition-all duration-100 ${timerColor}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 rounded-2xl bg-[#0D7A8A] p-3 relative">
        {/* Score with floating delta */}
        <div className="rounded-xl bg-white/10 px-2 py-2.5 text-center relative">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Score</p>
          <p className="mt-0.5 text-xl font-bold text-yellow-300">{score}</p>
          {visible && lastDelta !== null && (
            <span
              className={`absolute -top-4 left-1/2 -translate-x-1/2 text-xs font-black pointer-events-none animate-bounce ${
                lastDelta > 0 ? "text-[#4EFFA0]" : "text-red-300"
              }`}
            >
              {lastDelta > 0 ? `+${lastDelta}` : lastDelta}
            </span>
          )}
        </div>

        {/* Combo / mistakes */}
        <div className="rounded-xl bg-white/10 px-2 py-2.5 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">
            {combo >= 2 ? "Combo" : "Errors"}
          </p>
          {combo >= 2 ? (
            <p className="mt-0.5 text-xl font-bold text-orange-300">×{combo}</p>
          ) : (
            <p className={`mt-0.5 text-xl font-bold ${mistakes > 0 ? "text-orange-300" : "text-white"}`}>
              {mistakes}
            </p>
          )}
        </div>

        {/* Time */}
        <div className="rounded-xl bg-white/10 px-2 py-2.5 text-center">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-white/60">Time</p>
          <p className={`mt-0.5 text-xl font-bold ${isLow ? "text-red-300" : "text-white"}`}>
            {seconds}s
          </p>
        </div>
      </div>
    </div>
  );
}
