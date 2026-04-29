"use client";

import { useState } from "react";
import { X, Warning } from "@phosphor-icons/react";
import { PLAY_BUNDLES } from "@/hooks/games/useCredits";
import type { CreditStatus } from "@/hooks/games/useCredits";
import type { GameType } from "@/lib/games/types";
import { GAME_CONFIGS } from "@/lib/games/config";
import { MilesAmount } from "./miles-amount";

interface Props {
  open:         boolean;
  onClose:      () => void;
  gameType:     GameType;
  creditStatus: CreditStatus;
  onBuy:        (count: number) => Promise<void>;
  buying:       boolean;
  buyError:     string | null;
}

export function BuyPlaysSheet({ open, onClose, gameType, creditStatus, onBuy, buying, buyError }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const config    = GAME_CONFIGS[gameType];
  const costEach  = config.entryCostMiles;

  if (!open) return null;

  async function handleBuy() {
    if (!selected) return;
    await onBuy(selected);
    setSelected(null);
  }

  const { credits, playsToday, isDailyCapped } = creditStatus;
  const MAX_DAILY = 20;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-t-3xl bg-white px-5 pt-5 pb-8 shadow-2xl" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom))" }}>
        {/* header */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">Buy tickets</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 transition-colors">
            <X size={20} weight="bold" className="text-gray-500" />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Buy tickets upfront — enter any game instantly, no extra steps.
        </p>

        {/* status bar */}
        <div className="flex gap-3 mb-5">
          <div className="flex-1 bg-gray-50 rounded-2xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{credits}</p>
            <p className="text-xs text-gray-500 mt-0.5">tickets left</p>
          </div>
          <div className={`flex-1 rounded-2xl p-3 text-center ${isDailyCapped ? "bg-red-50" : "bg-gray-50"}`}>
            <p className={`text-2xl font-bold ${isDailyCapped ? "text-red-500" : "text-gray-900"}`}>
              {playsToday}/{MAX_DAILY}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">played today</p>
          </div>
        </div>

        {isDailyCapped && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-4">
            <Warning size={16} className="text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700">Daily limit reached. Tickets carry over to tomorrow.</p>
          </div>
        )}

        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1">
          Choose a bundle — <MilesAmount value={costEach} size={12} /> each
        </p>
        <div className="grid grid-cols-3 gap-2 mb-5">
          {PLAY_BUNDLES.map((b) => {
            const totalCost  = b.count * costEach;
            const isSelected = selected === b.count;
            return (
              <button
                key={b.count}
                onClick={() => setSelected(b.count)}
                className={`relative rounded-2xl border-2 p-3 text-left transition-all ${
                  isSelected
                    ? "border-[#0D7A8A] bg-[#0D7A8A]/5"
                    : "border-gray-100 bg-gray-50 hover:border-gray-200"
                }`}
              >
                {b.badge && (
                  <span className="absolute top-2 right-2 text-[9px] font-bold uppercase text-[#0D7A8A] bg-[#0D7A8A]/10 rounded-full px-1.5 py-0.5 leading-tight">
                    {b.badge}
                  </span>
                )}
                <p className="text-xl font-bold text-gray-900">{b.count}</p>
                <p className="text-xs text-gray-500">tickets</p>
                <div className="mt-1">
                  <MilesAmount value={totalCost} size={13} className="font-semibold text-gray-700" />
                </div>
              </button>
            );
          })}
        </div>

        {selected && (
          <p className="text-xs text-center text-gray-500 mb-3 flex items-center justify-center gap-1 flex-wrap">
            You'll spend <MilesAmount value={selected * costEach} size={12} className="font-semibold text-gray-800" /> for <span className="font-semibold text-gray-800">{selected} ticket{selected !== 1 ? "s" : ""}</span>.
          </p>
        )}

        {buyError && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5 mb-3">
            <Warning size={14} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-600 leading-relaxed">{buyError}</p>
          </div>
        )}

        <button
          onClick={handleBuy}
          disabled={!selected || buying}
          className="w-full rounded-2xl bg-[#0D7A8A] py-3.5 text-sm font-bold text-white transition-all disabled:opacity-40 active:scale-[0.98]"
        >
          {buying
            ? "Processing…"
            : selected
              ? `Buy ${selected} ticket${selected !== 1 ? "s" : ""}`
              : "Select a bundle"}
        </button>

        <p className="text-center text-[10px] text-gray-400 mt-3">
          Tickets are spent from your AkibaMiles balance. They never expire. Max 50 stored per game.
        </p>
      </div>
    </div>
  );
}
