// components/dice/DiceStatsSheet.tsx
"use client";

import Image from "next/image";
import { akibaMilesSymbol } from "@/lib/svg";
import { TIERS, type DiceTier, type TierStats, type PlayerStats } from "@/lib/diceTypes";

type Props = {
  open: boolean;
  onClose: () => void;
  selectedTier: DiceTier;
  tierStatsByTier: Partial<Record<DiceTier, TierStats>>;
  playerStats: PlayerStats;
};

function formatMilesAmount(x?: bigint | null) {
  if (!x) return "0";

  const raw = x;
  const ONE_E18 = 1_000_000_000_000_000_000n;

  // If huge, assume 18-decimals
  if (raw >= ONE_E18) {
    const whole = raw / ONE_E18;
    const num = Number(whole);
    return num.toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  }

  // Otherwise treat as plain Miles (no decimals)
  const num = Number(raw);
  return num.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

export function DiceStatsSheet({
  open,
  onClose,
  selectedTier,
  tierStatsByTier,
  playerStats,
}: Props) {
  if (!open) return null;

  const currentTierStats = tierStatsByTier[selectedTier] ?? null;

  const joined = playerStats?.roundsJoined ?? 0;
  const won = playerStats?.roundsWon ?? 0;
  const winRate = joined > 0 ? Math.round((won / joined) * 100) : 0;
  const totalStaked = formatMilesAmount(playerStats?.totalStaked);
  const totalWon = formatMilesAmount(playerStats?.totalWon);

  const winRateWidth = Math.min(winRate, 100);

  const hasAnyPlay =
    joined > 0 ||
    TIERS.some((t) => (tierStatsByTier[t]?.roundsCreated ?? 0) > 0);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/30 backdrop-blur-sm">
      {/* click-away backdrop */}
      <button
        className="absolute inset-0 w-full h-full"
        onClick={onClose}
        aria-label="Close stats"
      />

      {/* bottom sheet */}
      <div className="relative w-full max-w-md mx-auto rounded-t-3xl bg-white text-slate-900 border-t border-emerald-100 shadow-[0_-16px_40px_rgba(15,118,110,0.18)] overflow-hidden">
        {/* soft glow at top */}
        <div className="absolute inset-x-0 -top-10 h-16 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.35),_transparent_60%)] pointer-events-none" />

        <div className="relative p-4 space-y-4">
          {/* drag handle */}
          <div className="mx-auto h-1 w-12 rounded-full bg-slate-200" />

          {/* header */}
          <div className="flex items-center justify-between pt-1">
            <div className="space-y-1">
              <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Dice stats · Beta
                </span>
              </div>
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                Six-Sided Pot
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-100">
                  <Image
                    src={akibaMilesSymbol}
                    alt="Miles"
                    className="h-3 w-3"
                  />
                  {selectedTier.toLocaleString()} Miles tier
                </span>
              </h2>
            </div>
            <button
              onClick={onClose}
              className="text-xs text-slate-400 hover:text-slate-700 transition"
            >
              ✕
            </button>
          </div>

          {/* quick summary row */}
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="rounded-2xl bg-slate-50 border border-slate-200 px-2.5 py-2 space-y-1">
              <p className="text-slate-500">Rounds played</p>
              <p className="text-sm font-semibold text-slate-900">
                {joined}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 px-2.5 py-2 space-y-1">
              <p className="text-slate-500">Rounds won</p>
              <p className="text-sm font-semibold text-emerald-600">
                {won}
              </p>
            </div>
            <div className="rounded-2xl bg-slate-50 border border-slate-200 px-2.5 py-2 space-y-1">
              <p className="text-slate-500">Win rate</p>
              <p className="text-sm font-semibold">
                {winRate}%
              </p>
            </div>
          </div>

          {/* luck meter */}
          <div className="space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Luck meter</span>
              <span className="text-slate-700 font-medium">
                {winRate > 0 ? `${winRate}% hit rate` : "No wins yet"}
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-500 transition-all"
                style={{ width: `${winRateWidth}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500">
              Every round you join updates this bar. More wins = more green 
            </p>
          </div>

          {/* all tiers overview */}
          <div className="space-y-1.5 text-[10px]">
            <p className="text-slate-500">All tiers overview</p>
            <div className="grid grid-cols-3 gap-1.5">
              {TIERS.map((tier) => {
                const stats = tierStatsByTier[tier];
                const created = stats?.roundsCreated ?? 0;
                const resolved = stats?.roundsResolved ?? 0;
                return (
                  <div
                    key={tier}
                    className="rounded-xl bg-slate-50 border border-slate-200 px-2 py-1.5 space-y-0.5"
                  >
                    <p className="flex items-center justify-between text-[10px] text-slate-700">
                      <span>{tier}</span>
                      <span className="text-slate-400">Miles</span>
                    </p>
                    <p className="text-[10px]">
                      <span className="text-slate-500">Rounds: </span>
                      <span className="text-slate-800 font-medium">
                        {resolved}/{created}
                      </span>
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* main stat cards */}
          <div className="grid grid-cols-2 gap-3">
            {/* current tier */}
            <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-emerald-50 via-white to-emerald-50/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-slate-800 uppercase tracking-wide flex items-center gap-1">
                  <span className="text-xs">🏆</span>
                  Pot history
                </p>
                <span className="text-[10px] text-slate-500">
                  This tier
                </span>
              </div>
              <div className="space-y-1.5 text-[11px] text-slate-700">
                <div className="flex items-center justify-between">
                  <span>Rounds created</span>
                  <span className="font-semibold">
                    {currentTierStats?.roundsCreated ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Rounds resolved</span>
                  <span className="font-semibold">
                    {currentTierStats?.roundsResolved ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total staked</span>
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Image
                      src={akibaMilesSymbol}
                      alt="Miles"
                      className="h-3 w-3"
                    />
                    {formatMilesAmount(currentTierStats?.totalStaked)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total payout</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <Image
                      src={akibaMilesSymbol}
                      alt="Miles"
                      className="h-3 w-3"
                    />
                    {formatMilesAmount(currentTierStats?.totalPayout)}
                  </span>
                </div>
              </div>
            </div>

            {/* player record */}
            <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-white via-emerald-50 to-emerald-100/60 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-emerald-900 uppercase tracking-wide flex items-center gap-1">
                  <span className="text-xs">🎮</span>
                  Your record
                </p>
                <span className="text-[10px] text-emerald-700/80">
                  All tiers
                </span>
              </div>
              <div className="space-y-1.5 text-[11px] text-slate-800">
                <div className="flex items-center justify-between">
                  <span>Rounds joined</span>
                  <span className="font-semibold">{joined}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Rounds won</span>
                  <span className="font-semibold text-emerald-700">
                    {won}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total staked</span>
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <Image
                      src={akibaMilesSymbol}
                      alt="Miles"
                      className="h-3 w-3"
                    />
                    {totalStaked}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Total won</span>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
                    <Image
                      src={akibaMilesSymbol}
                      alt="Miles"
                      className="h-3 w-3"
                    />
                    {totalWon}
                  </span>
                </div>
              </div>

              {!hasAnyPlay && (
                <p className="mt-1 text-[10px] text-emerald-700/80">
                  Join your first pot on any tier to start building your streak.
                </p>
              )}
            </div>
          </div>

          <p className="text-[10px] text-slate-500">
            Dice is in <span className="font-semibold text-slate-800">beta</span>. 
            These stats are read directly from the dice smart contract for all tiers.
          </p>
        </div>
      </div>
    </div>
  );
}
