"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";

type AttemptTimerProps = {
  expiresAt: string;        // ISO timestamp
  totalSeconds?: number;    // default 60
  accentColor: string;
};

export function AttemptTimer({ expiresAt, totalSeconds = 60, accentColor }: AttemptTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    const id = setInterval(() => {
      const left = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) clearInterval(id);
    }, 500);
    return () => clearInterval(id);
  }, [expiresAt]);

  const pct = Math.max(0, remaining / totalSeconds);
  const isUrgent = remaining <= 30;
  const isCritical = remaining <= 15;

  const barColor = isCritical ? "#ef4444" : isUrgent ? "#f59e0b" : accentColor;

  return (
    <div className="w-full space-y-1">
      {/* Bar */}
      <div className="relative h-2 bg-slate-100 rounded-full overflow-hidden">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ backgroundColor: barColor }}
          animate={{ width: `${pct * 100}%` }}
          transition={{ duration: 0.5, ease: "linear" }}
        />
        {/* Critical pulse overlay */}
        {isCritical && (
          <motion.div
            className="absolute inset-0 rounded-full"
            style={{ backgroundColor: barColor }}
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ repeat: Infinity, duration: 0.6 }}
          />
        )}
      </div>

      {/* Label row */}
      <div className="flex justify-between items-center">
        <span className="text-[10px] text-slate-400 uppercase tracking-wide">Attempt timer</span>
        <motion.span
          key={remaining}
          initial={{ scale: isCritical ? 1.15 : 1 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.1 }}
          className={`text-xs font-bold tabular-nums ${
            isCritical ? "text-red-500" : isUrgent ? "text-amber-500" : "text-slate-500"
          }`}
        >
          {remaining}s
        </motion.span>
      </div>
    </div>
  );
}
