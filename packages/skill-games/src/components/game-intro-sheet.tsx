"use client";

import type { ReactNode } from "react";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet";
import { Trophy, ShoppingCart, Ticket } from "@phosphor-icons/react";
import type { RewardThreshold } from "../core/types";
import { MilesAmount } from "./miles-amount";

const TIER_COLORS = [
  { bg: "bg-[#FFF6D8]", text: "text-[#B7791F]", border: "border-[#B7791F22]" },
  { bg: "bg-[#F0F8FF]", text: "text-[#1E6DB0]", border: "border-[#1E6DB022]" },
  { bg: "bg-[#F0FFF6]", text: "text-[#138A45]", border: "border-[#138A4522]" },
];

export function GameIntroSheet({
  open,
  onOpenChange,
  entryMode,
  gameName,
  gameDescription,
  shortName,
  maxRewardMiles,
  thresholds,
  milesIcon,
  dailyPlayCap,
  playsRemaining,
  rules,
  onPlay,
  loading,
  disabled,
  disabledReason,
  error,
  credits = 0,
  mustBuy = false,
  onBuyTickets,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "free" shows remaining daily starts and no ticket/purchase CTA. */
  entryMode: "free" | "ticket";
  gameName: string;
  gameDescription: string;
  shortName: string;
  maxRewardMiles: number;
  thresholds: RewardThreshold[];
  milesIcon: ReactNode;
  dailyPlayCap: number;
  /** Free mode only — starts left today. */
  playsRemaining?: number;
  rules: string[];
  onPlay: () => void;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  error?: string | null;
  /** Ticket mode only — tickets the player holds for this game. */
  credits?: number;
  /** Ticket mode only — true when a ticket is required but the player has none. */
  mustBuy?: boolean;
  /** Ticket mode only — open the buy-tickets sheet. */
  onBuyTickets?: () => void;
}) {
  const hasTicket = credits > 0;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl bg-white px-0 pb-8 max-h-[92vh] overflow-y-auto" aria-describedby={undefined}>
        {/* Header band */}
        <div className="px-5 pt-2 pb-4 border-b border-[#F0F0F0]">
          <SheetTitle className="text-xl font-bold text-[#1A1A1A]">{gameName}</SheetTitle>
          <p className="text-sm text-[#525252] font-poppins mt-0.5">{gameDescription}</p>
        </div>

        {/* Entry banner */}
        {entryMode === "free" ? (
          <div className="mx-5 mt-4 rounded-xl bg-[#F0FDFF] border border-[#238D9D22] px-4 py-3">
            <p className="text-sm font-semibold text-[#238D9D] flex items-center gap-1.5">
              Free play
            </p>
            <p className="text-xs text-[#525252] font-poppins mt-0.5 flex items-center gap-1 flex-wrap">
              Win up to <MilesAmount value={maxRewardMiles} icon={milesIcon} />
              {playsRemaining != null ? ` · ${playsRemaining} of ${dailyPlayCap} starts left today` : ` · daily limit ${dailyPlayCap} ${shortName} rounds`}
            </p>
          </div>
        ) : mustBuy ? (
          <div className="mx-5 mt-4 rounded-xl bg-[#FFF8EC] border border-[#E0A23055] px-4 py-3">
            <p className="text-sm font-semibold text-[#B7791F] flex items-center gap-1.5 flex-wrap">
              <Ticket size={15} weight="fill" /> You need a ticket to play
            </p>
            <p className="text-xs text-[#8a6a22] font-poppins mt-0.5 flex items-center gap-1 flex-wrap">
              1 {shortName} ticket per round · win up to <MilesAmount value={maxRewardMiles} icon={milesIcon} />
            </p>
          </div>
        ) : hasTicket ? (
          <div className="mx-5 mt-4 rounded-xl bg-[#F0FDFF] border border-[#238D9D22] px-4 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[#238D9D] flex items-center gap-1.5">
                <Ticket size={15} weight="fill" /> Uses 1 {shortName} ticket
              </p>
              <span className="text-xs font-semibold text-[#238D9D] bg-[#238D9D14] rounded-full px-2 py-0.5">
                {credits} left
              </span>
            </div>
            <p className="text-xs text-[#525252] font-poppins mt-1 flex items-center gap-1 flex-wrap">
              Win up to <MilesAmount value={maxRewardMiles} icon={milesIcon} /> · daily limit {dailyPlayCap} {shortName} rounds
            </p>
          </div>
        ) : (
          <div className="mx-5 mt-4 rounded-xl bg-[#F0FDFF] border border-[#238D9D22] px-4 py-3">
            <p className="text-sm font-semibold text-[#238D9D] flex items-center gap-1.5">
              <Ticket size={15} weight="fill" /> 1 {shortName} ticket entry
            </p>
            <p className="text-xs text-[#525252] font-poppins mt-0.5 flex items-center gap-1 flex-wrap">
              Win up to <MilesAmount value={maxRewardMiles} icon={milesIcon} /> · daily limit {dailyPlayCap} {shortName} rounds
            </p>
          </div>
        )}

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
            {thresholds.map((t, i) => {
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
                    <MilesAmount value={t.miles} icon={milesIcon} />
                    {t.stable ? ` + $${t.stable.toFixed(2)}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mx-5 mt-5">
          {error && (
            <p className="mb-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          {disabled ? (
            <div className="w-full rounded-xl bg-[#F0F0F0] py-4 text-sm font-semibold text-[#888] text-center">
              {disabledReason ?? "Unavailable"}
            </div>
          ) : entryMode === "ticket" && mustBuy ? (
            <button
              type="button"
              onClick={onBuyTickets}
              className="w-full rounded-xl bg-[#238D9D] py-4 text-base font-bold text-white hover:bg-[#1a7a8a] flex items-center justify-center gap-1.5 active:scale-[0.99]"
            >
              <ShoppingCart size={16} weight="fill" /> Buy {shortName} tickets
            </button>
          ) : (
            <Button
              title={
                loading
                  ? "Starting round…"
                  : entryMode === "free"
                    ? "Play now →"
                    : hasTicket
                      ? "Play now · 1 ticket →"
                      : "Play now →"
              }
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
