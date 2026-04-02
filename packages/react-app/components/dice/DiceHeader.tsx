// components/dice/DiceHeader.tsx
"use client";

import Image from "next/image";
import { BarChart3 } from "lucide-react";
import type { DiceTier, MilesTier, UsdTier, TierStats, PlayerStats, DiceMode } from "@/lib/diceTypes";
import { MILES_TIERS, USD_TIERS, USD_TIER_META, MILES_TIER_BONUS_USD } from "@/lib/diceTypes";
import { akibaMilesSymbol } from "@/lib/svg";

type DiceHeaderProps = {
  onBack: () => void;
  mode: DiceMode;
  onModeChange: (mode: DiceMode) => void;
  selectedTier: DiceTier;
  onTierChange: (tier: DiceTier) => void;
  tierStats: TierStats;
  playerStats: PlayerStats;
  onOpenStats: () => void;
  stablecoinBalance: string | null;
};

export function DiceHeader({
  onBack,
  mode,
  onModeChange,
  selectedTier,
  onTierChange,
  tierStats,
  playerStats,
  onOpenStats,
  stablecoinBalance,
}: DiceHeaderProps) {
  const hasStats = !!tierStats || !!playerStats;

  return (
    <header className="space-y-2 relative z-10">
      {/* Row 1: Back | Title | Stats */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 shadow-sm hover:border-emerald-300 hover:text-emerald-700 active:scale-[0.97] transition"
        >
          <span>←</span>
          <span className="font-medium">Back</span>
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-base">🎲</span>
          <span className="text-[13px] font-semibold text-slate-900">Akiba Dice</span>
          <span className="rounded-full bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700">
            Beta
          </span>
        </div>

        {hasStats ? (
          <button
            onClick={onOpenStats}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:border-emerald-300 active:scale-[0.97] transition"
          >
            <BarChart3 className="h-3 w-3" />
            <span>Stats</span>
          </button>
        ) : (
          <div className="w-14" />
        )}
      </div>

      {/* Row 2: Mode toggle + USDT balance (if USD mode) */}
      <div className="flex items-center gap-2">
        <div className="flex-1 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-50 p-0.5">
          <button
            onClick={() => onModeChange("akiba")}
            className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all ${
              mode === "akiba"
                ? "bg-white shadow-sm text-emerald-700 border border-emerald-100"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Image src={akibaMilesSymbol} alt="Miles" className="h-3 w-3" />
            Akiba
          </button>

          {/* USD tab — locked until release */}
          <div className="relative flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold text-slate-300 cursor-not-allowed select-none">
            <span className="text-[12px] opacity-40">💵</span>
            <span className="opacity-40">USD</span>
            <span className="absolute -top-1.5 -right-1 rounded-full bg-slate-400 px-1.5 py-0.5 text-[7px] font-bold text-white leading-none shadow">
              Soon
            </span>
          </div>
        </div>
      </div>

      {/* Row 3: Tier chips */}
      {mode === "akiba" ? (
        <div className="grid grid-cols-3 gap-1.5">
          {MILES_TIERS.map((tier) => {
            const bonus = MILES_TIER_BONUS_USD[tier];
            const isActive = tier === selectedTier;
            return (
              <button
                key={tier}
                onClick={() => onTierChange(tier)}
                className={`relative flex flex-col items-center justify-center rounded-xl border py-1.5 text-center transition-all ${
                  isActive
                    ? "border-emerald-500 bg-white shadow-sm shadow-emerald-100 scale-[1.01]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300"
                }`}
              >
                <span className={`inline-flex items-center gap-0.5 text-[12px] font-bold ${isActive ? "text-emerald-700" : "text-slate-800"}`}>
                  {tier}
                  <Image src={akibaMilesSymbol} alt="M" className="h-2.5 w-2.5" />
                </span>
                <span className="text-[8px] text-slate-400">entry</span>
                {bonus && (
                  <span className="absolute -top-1.5 right-1 rounded-full bg-blue-500 px-1 py-0.5 text-[7px] font-bold text-white shadow">
                    +${bonus.toFixed(2)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1.5">
          {USD_TIERS.map((tier) => {
            const meta = USD_TIER_META[tier];
            const isActive = tier === selectedTier;
            return (
              <button
                key={tier}
                onClick={() => onTierChange(tier)}
                className={`flex flex-col items-center justify-center rounded-xl border py-1.5 text-center transition-all ${
                  isActive
                    ? "border-blue-500 bg-white shadow-sm shadow-blue-100 scale-[1.01]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-blue-300"
                }`}
              >
                <span className={`text-[12px] font-bold ${isActive ? "text-blue-700" : "text-slate-800"}`}>
                  ${meta.entry.toFixed(2)}
                </span>
                <span className="text-[8px] text-emerald-600 font-medium">→ ${meta.payout.toFixed(2)}</span>
              </button>
            );
          })}
        </div>
      )}
    </header>
  );
}
