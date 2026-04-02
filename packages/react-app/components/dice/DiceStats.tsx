// components/dice/DiceStatsSheet.tsx
"use client";

import Image from "next/image";
import { akibaMilesSymbol } from "@/lib/svg";
import {
  MILES_TIERS, USD_TIERS,
  type DiceTier, type TierStats, type PlayerStats, type DiceRoundView,
  isUsdTierType, shortAddress, formatUsdt, formatMiles,
} from "@/lib/diceTypes";

function usdTierLabel(tier: number): string {
  const map: Record<number, string> = { 250: "$0.25", 500: "$0.50", 1000: "$1.00" };
  return map[tier] ?? `$${(tier / 100).toFixed(2)}`;
}

type Props = {
  open: boolean;
  onClose: () => void;
  selectedTier: DiceTier;
  tierStatsByTier: Partial<Record<DiceTier, TierStats>>;
  playerStats: PlayerStats;
  /** Last resolved round the user participated in, keyed by tier */
  lastRoundByTier?: Partial<Record<DiceTier, DiceRoundView | null>>;
  myAddress?: string | null;
};

function TierAmount({ raw, isUsd }: { raw?: bigint | null; isUsd: boolean }) {
  if (isUsd) {
    return (
      <span className="font-semibold text-blue-700">{formatUsdt(raw)}</span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 font-semibold">
      <Image src={akibaMilesSymbol} alt="M" className="h-3 w-3" />
      {formatMiles(raw)}
    </span>
  );
}

export function DiceStatsSheet({
  open,
  onClose,
  selectedTier,
  tierStatsByTier,
  playerStats,
  lastRoundByTier = {},
  myAddress,
}: Props) {
  if (!open) return null;

  const isSelectedUsd = isUsdTierType(selectedTier);
  const currentTierStats = tierStatsByTier[selectedTier] ?? null;

  const joined = playerStats?.roundsJoined ?? 0;
  const won = playerStats?.roundsWon ?? 0;
  const winRate = joined > 0 ? Math.round((won / joined) * 100) : 0;

  // Player stats are mixed-unit (global). Show both Miles + USD columns
  const allTiers: DiceTier[] = [...MILES_TIERS, ...USD_TIERS];
  const lastRoundEntries = allTiers
    .map((t) => ({ tier: t, round: lastRoundByTier[t] ?? null }))
    .filter((x) => !!x.round);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/30 backdrop-blur-sm">
      <button className="absolute inset-0 w-full h-full" onClick={onClose} aria-label="Close stats" />

      <div className="relative w-full max-w-md mx-auto rounded-t-3xl bg-white text-slate-900 border-t border-emerald-100 shadow-[0_-16px_40px_rgba(15,118,110,0.18)] overflow-hidden max-h-[85dvh] flex flex-col">
        <div className="absolute inset-x-0 -top-10 h-16 bg-[radial-gradient(circle_at_top,_rgba(34,197,94,0.35),_transparent_60%)] pointer-events-none" />

        <div className="relative p-4 space-y-4 overflow-y-auto">
          {/* drag handle */}
          <div className="mx-auto h-1 w-12 rounded-full bg-slate-200" />

          {/* header */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-100 px-2 py-0.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                  Dice Stats
                </span>
              </div>
              <p className="text-sm font-semibold text-slate-900">
                Six-Sided Pot
                <span className={`ml-1.5 text-[11px] font-medium ${isSelectedUsd ? "text-blue-600" : "text-emerald-600"}`}>
                  {isSelectedUsd ? `${usdTierLabel(Number(selectedTier))} tier` : `${selectedTier} Miles tier`}
                </span>
              </p>
            </div>
            <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-700 transition">✕</button>
          </div>

          {/* quick summary */}
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            {[
              { label: "Rounds", value: joined },
              { label: "Won", value: won, green: true },
              { label: "Win rate", value: `${winRate}%` },
            ].map(({ label, value, green }) => (
              <div key={label} className="rounded-2xl bg-slate-50 border border-slate-200 px-2.5 py-2 space-y-0.5">
                <p className="text-slate-500">{label}</p>
                <p className={`text-sm font-semibold ${green ? "text-emerald-600" : "text-slate-900"}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* luck meter */}
          <div className="space-y-1 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Luck meter</span>
              <span className="text-slate-700 font-medium">{winRate > 0 ? `${winRate}% hit rate` : "No wins yet"}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rose-400 via-amber-300 to-emerald-500 transition-all"
                style={{ width: `${Math.min(winRate, 100)}%` }}
              />
            </div>
          </div>

          {/* current tier stats */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-3 space-y-2">
            <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wide flex items-center gap-1">
              🏆 Selected tier · {isSelectedUsd ? (
                <span className="text-blue-600">USDT</span>
              ) : (
                <span className="text-emerald-600">Miles</span>
              )}
            </p>
            <div className="space-y-1.5 text-[11px] text-slate-700">
              <div className="flex justify-between">
                <span>Rounds created</span>
                <span className="font-semibold">{currentTierStats?.roundsCreated ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Rounds resolved</span>
                <span className="font-semibold">{currentTierStats?.roundsResolved ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span>Total payout</span>
                <TierAmount raw={currentTierStats?.totalPayout} isUsd={isSelectedUsd} />
              </div>
            </div>
          </div>

          {/* all tiers overview */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">All tiers</p>
            <div className="grid grid-cols-3 gap-1.5">
              {([...MILES_TIERS] as DiceTier[]).map((tier) => {
                const stats = tierStatsByTier[tier];
                return (
                  <div key={tier} className="rounded-xl bg-slate-50 border border-slate-200 px-2 py-1.5 space-y-0.5">
                    <div className="flex items-center gap-0.5">
                      <Image src={akibaMilesSymbol} alt="M" className="h-2.5 w-2.5" />
                      <span className="text-[10px] font-semibold text-slate-700">{tier}</span>
                    </div>
                    <p className="text-[9px] text-slate-500">
                      {stats?.roundsResolved ?? 0}/{stats?.roundsCreated ?? 0} resolved
                    </p>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {([...USD_TIERS] as DiceTier[]).map((tier) => {
                const stats = tierStatsByTier[tier];
                const meta = usdTierLabel(Number(tier));
                return (
                  <div key={tier} className="rounded-xl bg-blue-50 border border-blue-100 px-2 py-1.5 space-y-0.5">
                    <span className="text-[10px] font-semibold text-blue-700">{meta}</span>
                    <p className="text-[9px] text-blue-500">
                      {stats?.roundsResolved ?? 0}/{stats?.roundsCreated ?? 0} resolved
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* last round winner per tier */}
          {lastRoundEntries.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">
                Your recent rounds
              </p>
              <div className="space-y-1.5">
                {lastRoundEntries.map(({ tier, round }) => {
                  if (!round) return null;
                  const isUsd = isUsdTierType(tier as DiceTier);
                  const iWon = round.winner && myAddress &&
                    round.winner.toLowerCase() === myAddress.toLowerCase();
                  const tierLabel = isUsd
                    ? usdTierLabel(Number(tier))
                    : `${tier} Miles`;

                  return (
                    <div
                      key={tier}
                      className={`rounded-xl border px-3 py-2 flex items-center gap-2.5 ${
                        iWon
                          ? "bg-emerald-50 border-emerald-200"
                          : "bg-slate-50 border-slate-200"
                      }`}
                    >
                      <div className={`h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 text-[12px] font-extrabold ${
                        iWon ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-600"
                      }`}>
                        #{round.winningNumber}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] text-slate-500">{tierLabel} · Round #{round.roundId.toString()}</p>
                        <p className={`text-[11px] font-semibold truncate ${iWon ? "text-emerald-700" : "text-slate-700"}`}>
                          {iWon ? "You won 🎉" : `Won by ${shortAddress(round.winner ?? "")}`}
                          {round.myNumber != null && ` · Your number: #${round.myNumber}`}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <p className="text-[10px] text-slate-400 pb-2">
            Stats read directly from the smart contract.
          </p>
        </div>
      </div>
    </div>
  );
}
