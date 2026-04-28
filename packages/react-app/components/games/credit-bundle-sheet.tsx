"use client";

import { useState } from "react";
import { X, Lightning, CheckCircle, Warning } from "@phosphor-icons/react";
import { CREDIT_BUNDLES } from "@/hooks/games/useCredits";
import type { CreditStatus } from "@/hooks/games/useCredits";
import type { GameType } from "@/lib/games/types";
import { GAME_CONFIGS } from "@/lib/games/config";

interface Props {
  open:        boolean;
  onClose:     () => void;
  gameType:    GameType;
  creditStatus: CreditStatus;
  onBuy:       (count: number) => Promise<void>;
  buying:      boolean;
  buyError:    string | null;
}

export function CreditBundleSheet({ open, onClose, gameType, creditStatus, onBuy, buying, buyError }: Props) {
  const [selected, setSelected] = useState<number | null>(null);
  const config   = GAME_CONFIGS[gameType];
  const costEach = config.entryCostMiles;

  if (!open) return null;

  async function handleBuy() {
    if (!selected) return;
    await onBuy(selected);
    setSelected(null);
  }

  const { credits, playsToday, playsRemaining, isDailyCapped } = creditStatus;
  const MAX_DAILY = 20;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-t-3xl bg-white pb-safe px-5 pt-5 pb-8 shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-bold text-gray-900">Play Credits</h2>
          <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-100 transition-colors">
            <X size={20} weight="bold" className="text-gray-500" />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          Buy credits upfront — pay once, start instantly every time with zero confirmation delays.
        </p>

        {/* status bar */}
        <div className="flex gap-3 mb-5">
          <div className="flex-1 bg-gray-50 rounded-2xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-900">{credits}</p>
            <p className="text-xs text-gray-500 mt-0.5">credits left</p>
          </div>
          <div className={`flex-1 rounded-2xl p-3 text-center ${isDailyCapped ? "bg-red-50" : "bg-gray-50"}`}>
            <p className={`text-2xl font-bold ${isDailyCapped ? "text-red-500" : "text-gray-900"}`}>
              {playsToday}/{MAX_DAILY}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">today's plays</p>
          </div>
          {!isDailyCapped && (
            <div className="flex-1 bg-green-50 rounded-2xl p-3 text-center">
              <p className="text-2xl font-bold text-green-600">{playsRemaining}</p>
              <p className="text-xs text-gray-500 mt-0.5">remaining</p>
            </div>
          )}
        </div>

        {isDailyCapped && (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mb-4">
            <Warning size={16} className="text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700">Daily limit reached. Credits carry over to tomorrow.</p>
          </div>
        )}

        {/* bundles */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Choose a bundle — {costEach} miles each
        </p>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {CREDIT_BUNDLES.map((b) => {
            const totalCost = b.count * costEach;
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
                {b.discount && (
                  <span className="absolute top-2 right-2 text-[9px] font-bold uppercase text-[#0D7A8A] bg-[#0D7A8A]/10 rounded-full px-1.5 py-0.5">
                    {b.discount}
                  </span>
                )}
                <p className="text-lg font-bold text-gray-900">{b.count}</p>
                <p className="text-xs text-gray-500">{b.count === 1 ? "play" : "plays"}</p>
                <p className="text-sm font-semibold text-gray-700 mt-1">{totalCost.toLocaleString()} mi</p>
              </button>
            );
          })}
        </div>

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
            ? "Confirming…"
            : selected
              ? `Buy ${selected} credit${selected > 1 ? "s" : ""} · ${(selected * costEach).toLocaleString()} miles`
              : "Select a bundle"}
        </button>

        <p className="text-center text-[10px] text-gray-400 mt-3">
          Miles are burned immediately. Credits never expire. Max 50 stored per game.
        </p>
      </div>
    </div>
  );
}
