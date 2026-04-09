// components/dice/DiceHeader.tsx
"use client";

import Image from "next/image";
import { BarChart3 } from "lucide-react";
import type { DiceTier, MilesTier, UsdTier, TierStats, PlayerStats, DiceMode } from "@/lib/diceTypes";
import { MILES_TIERS, USD_TIERS, USD_TIER_META, MILES_TIER_BONUS_USD } from "@/lib/diceTypes";
import { akibaMilesSymbol, usdtSymbol } from "@/lib/svg";

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
  allowUsdMode?: boolean;
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
  allowUsdMode = true,
}: DiceHeaderProps) {
  const hasStats = !!tierStats || !!playerStats;

  return (
    <header className="space-y-2 relative z-10">
      {/* Row 1: Back | Title | Stats */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 shadow-sm hover:border-[#238D9D]/40 hover:text-[#238D9D] active:scale-[0.97] transition"
        >
          <span>←</span>
          <span className="font-medium">Back</span>
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-base">🎲</span>
          <span className="text-[13px] font-semibold text-slate-900">Akiba Dice</span>
          <span className="rounded-full bg-[#238D9D]/10 border border-[#238D9D]/20 px-1.5 py-0.5 text-[9px] font-medium text-[#238D9D]">
            Beta
          </span>
        </div>

        {hasStats ? (
          <button
            onClick={onOpenStats}
            className="relative inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:border-[#238D9D]/40 active:scale-[0.97] transition"
          >
            <BarChart3 className="h-3 w-3" />
            <span>Stats</span>
            {(playerStats?.roundsWon ?? 0) >= 2 && (
              <span className="absolute -top-2 -right-2 text-[13px] leading-none" title="On a roll!">🔥</span>
            )}
          </button>
        ) : (
          <div className="w-14" />
        )}
      </div>

      {/* Row 2: Mode toggle + USDT balance (if USD mode) */}
      <div className="flex items-center gap-2">
        <div className={`flex-1 grid ${allowUsdMode ? "grid-cols-2" : "grid-cols-1"} gap-1 rounded-xl border border-slate-200 bg-slate-50 p-0.5`}>
          <button
            onClick={() => onModeChange("akiba")}
            className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all ${
              mode === "akiba"
                ? "bg-white shadow-sm text-[#238D9D] border border-[#238D9D]/20"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Image src={akibaMilesSymbol} alt="Miles" width={12} height={12} className="h-3 w-3" />
            Akiba
          </button>

          {allowUsdMode && (
            <button
              onClick={() => onModeChange("usd")}
              className={`flex items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-semibold transition-all ${
                mode === "usd"
                  ? "bg-white shadow-sm text-blue-600 border border-blue-200"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Image src={usdtSymbol} alt="USDT" width={12} height={12} />
              USDT
            </button>
          )}
        </div>
      </div>

      {/* Row 3: Tier chips */}
      {mode === "akiba" ? (
        <div className="grid grid-cols-3 gap-1.5">
          {MILES_TIERS.map((tier) => {
            const isActive = tier === selectedTier;
            const bonus = MILES_TIER_BONUS_USD[tier as MilesTier];
            return (
              <button
                key={tier}
                onClick={() => onTierChange(tier)}
                className={`relative flex flex-col items-center justify-center rounded-xl border py-1.5 text-center transition-all ${
                  isActive
                    ? "border-[#238D9D] bg-white shadow-sm shadow-[#238D9D]/20 scale-[1.01]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-[#238D9D]/40"
                }`}
              >
                {bonus && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 rounded-full bg-amber-400 px-1.5 py-0.5 text-[7px] font-bold text-white leading-none shadow-sm whitespace-nowrap">
                    +${bonus.toFixed(2)}
                  </span>
                )}
                <span className={`inline-flex items-center gap-0.5 text-[12px] font-bold ${isActive ? "text-[#238D9D]" : "text-slate-800"}`}>
                  {tier}
                  <Image src={akibaMilesSymbol} alt="M" className="h-2.5 w-2.5" />
                </span>
                <span className="text-[8px] text-slate-400">entry</span>
              </button>
            );
          })}
        </div>
      ) : allowUsdMode ? (
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
                <span className="text-[8px] text-[#238D9D] font-medium">→ ${meta.payout.toFixed(2)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </header>
  );
}
