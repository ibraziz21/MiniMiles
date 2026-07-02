"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { type PotState, type ThemeConfig, type CrackPotVersion } from "@/lib/crackpotTypes";
import { akibaMilesSymbol, usdtSymbol } from "@/lib/svg";
import { TokenAmount } from "./TokenAmount";

type PotDisplayProps = {
  potState: PotState;
  potBalance: number;
  potBalanceUsdt?: number;
  potCap: number;
  secondsRemaining: number;
  theme: ThemeConfig;
  version: CrackPotVersion;
};

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

const STATE_CONFIG: Record<PotState, { emoji: string; label: string; pulseClass: string; glowColor: string }> = {
  seeded:   { emoji: "🫙", label: "Waiting...",   pulseClass: "",              glowColor: "rgba(100,100,100,0.2)" },
  growing:  { emoji: "🪴", label: "Growing",      pulseClass: "animate-pulse", glowColor: "rgba(34,197,94,0.3)"  },
  hot:      { emoji: "🌡️", label: "Heating Up",  pulseClass: "animate-pulse", glowColor: "rgba(251,146,60,0.4)" },
  burning:  { emoji: "🔥", label: "ON FIRE",      pulseClass: "animate-bounce",glowColor: "rgba(239,68,68,0.5)"  },
  cracked:  { emoji: "💥", label: "CRACKED!",     pulseClass: "",              glowColor: "rgba(234,179,8,0.6)"  },
  dead:     { emoji: "💀", label: "Pot Imploded", pulseClass: "",              glowColor: "rgba(100,100,100,0.1)" },
};

export function PotDisplay({ potState, potBalance, potBalanceUsdt, potCap, secondsRemaining, theme, version }: PotDisplayProps) {
  const [tick, setTick] = useState(secondsRemaining);
  const isUsdt = version === "usdt";

  useEffect(() => {
    setTick(secondsRemaining);
    if (potState === "cracked" || potState === "dead") return;
    const id = setInterval(() => setTick((t) => Math.max(0, t - 1)), 1000);
    return () => clearInterval(id);
  }, [secondsRemaining, potState]);

  const cfg = STATE_CONFIG[potState];
  const fillPct = Math.min(100, Math.round((potBalance / potCap) * 100));
  const displayAmount = isUsdt
    ? `$${(potBalanceUsdt ?? potBalance / 100).toFixed(2)}`
    : potBalance.toLocaleString();
  const capDisplay = isUsdt ? `$${(potCap / 100).toFixed(0)}` : potCap.toLocaleString();

  return (
    <div className="flex flex-col items-center gap-3 py-4">
      {/* Pot character */}
      <div
        className={`relative flex items-center justify-center w-32 h-32 rounded-full transition-all duration-500 ${cfg.pulseClass}`}
        style={{ boxShadow: `0 0 40px 10px ${cfg.glowColor}` }}
      >
        <span className="text-7xl select-none" role="img" aria-label={theme.potLabel}>
          {cfg.emoji}
        </span>
        <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-full bg-white/80 text-slate-700 border border-slate-200 whitespace-nowrap">
          {cfg.label}
        </span>
      </div>

      {/* Pot balance — symbol first */}
      <div className="text-center">
        <TokenAmount
          amount={displayAmount}
          isUsdt={isUsdt}
          symbolSize={28}
          textClass="text-4xl font-black tracking-tight"
          gap="gap-2"
        />
        <div className="text-xs text-slate-400 mt-1">in the pot</div>
      </div>

      {/* Fill bar */}
      <div className="w-full max-w-xs">
        <div className="flex justify-between text-[11px] text-slate-400 mb-1">
          <span>Pot fill</span>
          <span className="flex items-center gap-1">
            {fillPct}% of
            <TokenAmount amount={capDisplay} isUsdt={isUsdt} symbolSize={11} textClass="font-medium" gap="gap-0.5" />
            cap
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${fillPct}%`, backgroundColor: theme.accentColor }}
          />
        </div>
      </div>

      {/* Timer */}
      {potState !== "cracked" && potState !== "dead" && (
        <div className="text-center">
          <div className={`text-2xl font-bold tabular-nums ${tick < 3600 ? "text-red-500" : "text-slate-700"}`}>
            {formatTime(tick)}
          </div>
          <div className="text-xs text-slate-400">until pot resets</div>
        </div>
      )}

      {/* Theme + version badge */}
      <div className="flex gap-2">
        <div className="text-xs font-medium text-slate-400 border border-slate-200 rounded-full px-3 py-1">
          {theme.label}
        </div>
        <div className={`text-xs font-semibold rounded-full px-3 py-1 flex items-center gap-1 ${isUsdt ? "bg-green-50 text-green-700 border border-green-200" : "bg-blue-50 text-blue-700 border border-blue-200"}`}>
          <Image src={isUsdt ? usdtSymbol : akibaMilesSymbol} alt="" width={12} height={12} />
          {isUsdt ? "USDT" : "Miles"}
        </div>
      </div>
    </div>
  );
}
