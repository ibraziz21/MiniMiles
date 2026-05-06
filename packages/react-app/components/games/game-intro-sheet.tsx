"use client";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Trophy } from "@phosphor-icons/react";
import type { GameConfig } from "@/lib/games/types";
import { MilesAmount } from "./miles-amount";

const TIER_COLORS = [
  { bg: "bg-[#FFF6D8]", text: "text-[#B7791F]", border: "border-[#B7791F22]" },
  { bg: "bg-[#F0F8FF]", text: "text-[#1E6DB0]", border: "border-[#1E6DB022]" },
  { bg: "bg-[#F0FFF6]", text: "text-[#138A45]", border: "border-[#138A4522]" },
];

export function GameIntroSheet({
  open,
  onOpenChange,
  config,
  rules,
  onPlay,
  loading,
  disabled,
  disabledReason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: GameConfig;
  rules: string[];
  onPlay: () => void;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl bg-white px-0 pb-8 max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>
        {/* Header band */}
        <div className="px-5 pt-2 pb-4 border-b border-[#F0F0F0]">
          <SheetTitle className="text-xl font-bold text-[#1A1A1A]">{config.name}</SheetTitle>
          <p className="text-sm text-[#525252] font-poppins mt-0.5">{config.description}</p>
        </div>

        {/* Entry cost banner */}
        <div className="mx-5 mt-4 rounded-xl bg-[#F0FDFF] border border-[#238D9D22] px-4 py-3">
          <p className="text-sm font-semibold text-[#238D9D]">1 ticket entry</p>
          <p className="text-xs text-[#525252] font-poppins mt-0.5 flex items-center gap-1 flex-wrap">
            Win up to <MilesAmount value={config.maxRewardMiles} size={12} /> · daily limit {config.dailyPlayCap} rounds
          </p>
        </div>

        {/* Rules */}
        <div className="mx-5 mt-4">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#817E7E] mb-2">How to play</p>
          <div className="space-y-2">
            {rules.map((rule, i) => (
              <div key={rule} className="flex items-start gap-2.5 rounded-xl bg-[#F7F7F7] px-3 py-2.5">
                <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-[#238D9D1A] text-xs font-bold text-[#238D9D]">
                  {i + 1}
                </span>
                <p className="text-sm text-[#525252] leading-snug">{rule}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Reward tiers */}
        <div className="mx-5 mt-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Trophy size={14} className="text-amber-500" />
            <p className="text-xs font-semibold uppercase tracking-widest text-[#817E7E]">Reward tiers</p>
          </div>
          <div className="space-y-2">
            {config.thresholds.map((t, i) => {
              const colors = TIER_COLORS[Math.min(i, TIER_COLORS.length - 1)];
              return (
                <div
                  key={t.label}
                  className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${colors.bg} ${colors.border}`}
                >
                  <div>
                    <p className={`text-sm font-semibold ${colors.text}`}>{t.label}</p>
                    <p className="text-xs text-[#817E7E]">{t.minScore}+ score</p>
                  </div>
                  <p className={`text-sm font-bold ${colors.text} flex items-center gap-1`}>
                    <MilesAmount value={t.miles} size={14} />
                    {t.stable ? ` + $${t.stable.toFixed(2)}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mx-5 mt-5">
          {disabled ? (
            <div className="w-full rounded-xl bg-[#F0F0F0] py-4 text-sm font-semibold text-[#888] text-center">
              {disabledReason ?? "Unavailable"}
            </div>
          ) : (
            <Button
              title={loading ? "Starting round…" : "Play now →"}
              loading={loading}
              widthFull
              className="rounded-xl bg-[#238D9D] py-5 text-base font-bold text-white hover:bg-[#1a7a8a]"
              onClick={onPlay}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
