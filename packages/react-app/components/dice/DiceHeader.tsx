// components/dice/DiceHeader.tsx
"use client";

import Image from "next/image";
import { BarChart3 } from "lucide-react";
import type { DiceTier, TierStats, PlayerStats } from "@/lib/diceTypes";
import { akibaMilesSymbol } from "@/lib/svg";

type DiceHeaderProps = {
  onBack: () => void;
  selectedTier: DiceTier;
  onTierChange: (tier: DiceTier) => void;
  tierStats: TierStats;
  playerStats: PlayerStats;
  onOpenStats: () => void;
};

const TIERS: DiceTier[] = [10, 20, 30];

const TIER_META: Record<DiceTier, { label: string }> = {
  10: { label: "Smaller pot" },
  20: { label: "Medium pot" },
  30: { label: "Bigger pot" },
};

export function DiceHeader({
  onBack,
  selectedTier,
  onTierChange,
  tierStats,
  playerStats,
  onOpenStats,
}: DiceHeaderProps) {
  const hasStats = !!tierStats || !!playerStats;

  return (
    <header className="space-y-3 relative z-10">
      {/* Top row: back + stats */}
      <div className="flex items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 shadow-sm hover:border-emerald-300 hover:text-emerald-700 active:scale-[0.97] transition"
        >
          <span className="text-xs">←</span>
          <span className="font-medium">Back</span>
        </button>

        {hasStats && (
          <button
            onClick={onOpenStats}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-700 shadow-sm hover:border-emerald-300 hover:text-emerald-800 active:scale-[0.97] transition"
          >
            <BarChart3 className="h-3.5 w-3.5" />
            <span>Stats</span>
          </button>
        )}
      </div>

      {/* Compact game header card */}
      <div className="rounded-2xl border border-emerald-100 bg-gradient-to-r from-emerald-50 to-teal-50 px-3 py-3 flex items-center gap-3">
        {/* Dice chip */}
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-sm border border-emerald-100 text-lg">
          🎲
        </div>

        {/* Title + short explainer */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              Akiba Dice
            </p>
            <span className="rounded-full bg-white/80 px-1.5 py-0.5 text-[9px] font-medium text-emerald-700 border border-emerald-100">
              Beta
            </span>
          </div>
          <h1 className="text-[17px] font-semibold leading-snug text-slate-900">
            Six-Sided Pot
          </h1>
          <p className="text-[11px] text-slate-600">
            Pick a free number, join with Miles, and let the dice decide the winner.
          </p>
        </div>
      </div>

      {/* Tier selector – simple chips */}
      <section className="space-y-1.5">
        <div className="flex items-center justify-between text-[10px] text-slate-500">
          <span className="font-medium uppercase tracking-wide">
            Entry size
          </span>
          <span className="inline-flex items-center gap-1 text-slate-600">
            <span className="font-semibold text-[11px]">
              {selectedTier.toLocaleString()}
            </span>
            <Image
              src={akibaMilesSymbol}
              alt="Miles"
              className="h-3 w-3"
            />
          </span>
        </div>

        <div className="grid grid-cols-3 gap-1.5">
          {TIERS.map((tier) => {
            const meta = TIER_META[tier];
            const isActive = tier === selectedTier;

            return (
              <button
                key={tier}
                onClick={() => onTierChange(tier)}
                className={`flex flex-col items-start justify-center rounded-2xl border px-2.5 py-1.5 text-left transition-all ${
                  isActive
                    ? "border-emerald-500 bg-white text-emerald-700 shadow-sm shadow-emerald-100 scale-[1.01]"
                    : "border-slate-200 bg-white text-slate-700 hover:border-emerald-300"
                }`}
              >
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
                  {tier.toLocaleString()}
                  <Image
                    src={akibaMilesSymbol}
                    alt="Miles"
                    className="h-3 w-3"
                  />
                </span>
                <span className="text-[9px] text-slate-500">
                  {meta.label}
                </span>
              </button>
            );
          })}
        </div>

        <p className="text-[10px] text-slate-500">
          Same 1-in-6 odds on every tier — higher entries just mean a bigger pot.
        </p>
      </section>
    </header>
  );
}
