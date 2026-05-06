// components/dice/DiceStatsSheet.tsx
"use client";

import Image from "next/image";
import { akibaMilesSymbol, akibaMilesSymbolAlt } from "@/lib/svg";
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
  onTierChange?: (tier: DiceTier) => void;
  allowUsdTiers?: boolean;
};

const NUMBER_COLORS: Record<number, string> = {
  1: "bg-rose-500",
  2: "bg-orange-500",
  3: "bg-amber-500",
  4: "bg-teal-500",
  5: "bg-blue-500",
  6: "bg-violet-500",
};

function MilesAmount({ raw }: { raw?: bigint | null }) {
  return (
    <span className="inline-flex items-center gap-0.5 font-semibold text-[#238D9D]">
      <Image src={akibaMilesSymbolAlt} alt="" width={12} height={12} className="inline" />
      <span>{formatMiles(raw)}</span>
    </span>
  );
}

function UsdAmount({ raw }: { raw?: bigint | null }) {
  return <span className="font-semibold text-blue-600">{formatUsdt(raw)}</span>;
}

function StatCard({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-100 shadow-sm px-3 py-2.5 space-y-0.5">
      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{label}</p>
      <p className="text-[14px] font-bold text-slate-900 leading-tight">{value}</p>
      {sub && <p className="text-[9px] text-slate-400">{sub}</p>}
    </div>
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
  onTierChange,
  allowUsdTiers = true,
}: Props) {
  if (!open) return null;

  const isSelectedUsd = isUsdTierType(selectedTier);
  const currentTierStats = tierStatsByTier[selectedTier] ?? null;

  const joined = playerStats?.roundsJoined ?? 0;
  const won = playerStats?.roundsWon ?? 0;
  const lost = joined - won;
  const winRate = joined > 0 ? Math.round((won / joined) * 100) : 0;
  const wonPct = joined > 0 ? (won / joined) * 100 : 0;
  const lostPct = joined > 0 ? (lost / joined) * 100 : 0;

  const totalStaked = playerStats?.totalStaked ?? 0n;
  const totalWon = playerStats?.totalWon ?? 0n;
  const isNet = totalWon >= totalStaked;

  const allTiers: DiceTier[] = allowUsdTiers ? [...MILES_TIERS, ...USD_TIERS] : [...MILES_TIERS];
  const lastRoundEntries = allTiers
    .map((t) => ({ tier: t, round: lastRoundByTier[t] ?? null }))
    .filter((x) => !!x.round);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/30 backdrop-blur-sm">
      <button className="absolute inset-0 w-full h-full" onClick={onClose} aria-label="Close stats" />

      <div className="relative w-full max-w-md mx-auto rounded-t-3xl bg-slate-50 text-slate-900 border-t border-[#238D9D]/20 shadow-[0_-16px_40px_rgba(35,141,157,0.18)] overflow-hidden max-h-[88dvh] flex flex-col">
        {/* Glow accent */}
        <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#238D9D]/8 to-transparent pointer-events-none" />

        <div className="relative flex flex-col h-full overflow-hidden">
          {/* Sticky header */}
          <div className="flex-shrink-0 px-4 pt-3 pb-2 space-y-2">
            <div className="mx-auto h-1 w-10 rounded-full bg-slate-200" />

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">🎲</span>
                <div>
                  <p className="text-[13px] font-bold text-slate-900 leading-tight">Your Stats</p>
                  <p className={`text-[10px] font-medium ${isSelectedUsd ? "text-blue-500" : "text-[#238D9D]"}`}>
                    {isSelectedUsd ? `USDT · ${usdTierLabel(Number(selectedTier))} tier` : `Miles · ${selectedTier} tier`}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="h-7 w-7 rounded-full bg-slate-100 flex items-center justify-center text-[12px] text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-4 pb-6 space-y-4">

            {/* Win/Loss breakdown */}
            <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-3 space-y-2.5">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Performance</p>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl bg-slate-50 border border-slate-100 px-2.5 py-2 text-center">
                  <p className="text-[18px] font-extrabold text-slate-900">{joined}</p>
                  <p className="text-[9px] text-slate-400 uppercase tracking-wide font-medium">Rounds</p>
                </div>
                <div className="rounded-xl bg-[#238D9D]/5 border border-[#238D9D]/15 px-2.5 py-2 text-center">
                  <p className="text-[18px] font-extrabold text-[#238D9D]">
                    {won}{won >= 2 && <span className="text-[14px] ml-0.5">🔥</span>}
                  </p>
                  <p className="text-[9px] text-[#238D9D]/60 uppercase tracking-wide font-medium">Won</p>
                </div>
                <div className="rounded-xl bg-rose-50 border border-rose-100 px-2.5 py-2 text-center">
                  <p className="text-[18px] font-extrabold text-rose-500">{lost}</p>
                  <p className="text-[9px] text-rose-400 uppercase tracking-wide font-medium">Lost</p>
                </div>
              </div>

              {/* Win/loss bar */}
              {joined > 0 && (
                <div className="space-y-1">
                  <div className="flex justify-between text-[9px] text-slate-400 font-medium">
                    <span>Win {winRate}%</span>
                    <span>Loss {100 - winRate}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden flex">
                    <div
                      className="h-full bg-[#238D9D] rounded-l-full transition-all duration-700"
                      style={{ width: `${wonPct}%` }}
                    />
                    <div
                      className="h-full bg-rose-400 rounded-r-full transition-all duration-700"
                      style={{ width: `${lostPct}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Net position — Miles only (playerStats.totalStaked is Miles for Miles mode) */}
            {!isSelectedUsd && joined > 0 && (
              <div className={`rounded-2xl border p-3 space-y-2 ${isNet ? "bg-[#238D9D]/5 border-[#238D9D]/20" : "bg-rose-50 border-rose-100"}`}>
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Net position</p>
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-400 font-medium">Spent</p>
                    <MilesAmount raw={totalStaked} />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-400 font-medium">Won</p>
                    <MilesAmount raw={totalWon} />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-[9px] text-slate-400 font-medium">Net</p>
                    <span className={`inline-flex items-center gap-0.5 font-bold text-[12px] ${isNet ? "text-[#238D9D]" : "text-rose-500"}`}>
                      {isNet ? "+" : "−"}
                      <Image src={akibaMilesSymbolAlt} alt="" width={12} height={12} className="inline" />
                      <span>{formatMiles(isNet ? totalWon - totalStaked : totalStaked - totalWon)}</span>
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Current tier global stats */}
            <div className="rounded-2xl bg-white border border-slate-100 shadow-sm p-3 space-y-2">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">
                {isSelectedUsd ? `USDT ${usdTierLabel(Number(selectedTier))}` : `${selectedTier} Miles`} · Global
              </p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="space-y-0.5">
                  <p className="text-[16px] font-extrabold text-slate-800">{currentTierStats?.roundsCreated ?? 0}</p>
                  <p className="text-[9px] text-slate-400 font-medium">Created</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[16px] font-extrabold text-slate-800">{currentTierStats?.roundsResolved ?? 0}</p>
                  <p className="text-[9px] text-slate-400 font-medium">Resolved</p>
                </div>
                <div className="space-y-0.5">
                  <p className="text-[14px] font-extrabold text-slate-800">
                    {isSelectedUsd
                      ? <UsdAmount raw={currentTierStats?.totalPayout} />
                      : <MilesAmount raw={currentTierStats?.totalPayout} />
                    }
                  </p>
                  <p className="text-[9px] text-slate-400 font-medium">Paid out</p>
                </div>
              </div>
            </div>

            {/* All tiers overview — tappable */}
            <div className="space-y-2">
              <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">All tiers</p>
              <div className="grid grid-cols-3 gap-1.5">
                {([...MILES_TIERS] as DiceTier[]).map((tier) => {
                  const stats = tierStatsByTier[tier];
                  const isActive = tier === selectedTier;
                  return (
                    <button
                      key={tier}
                      onClick={() => { onTierChange?.(tier); onClose(); }}
                      className={`rounded-xl border px-2 py-2 text-left space-y-0.5 transition-all active:scale-[0.97] ${
                        isActive
                          ? "bg-[#238D9D]/10 border-[#238D9D]/30 shadow-sm"
                          : "bg-white border-slate-100 hover:border-[#238D9D]/30"
                      }`}
                    >
                      <div className="flex items-center gap-0.5">
                        <Image src={akibaMilesSymbol} alt="M" className="h-2.5 w-2.5" />
                        <span className={`text-[10px] font-bold ${isActive ? "text-[#238D9D]" : "text-slate-700"}`}>{tier}</span>
                        {isActive && <span className="ml-auto text-[7px] text-[#238D9D] font-bold">●</span>}
                      </div>
                      <p className="text-[8px] text-slate-400">
                        {stats?.roundsResolved ?? 0} done
                      </p>
                    </button>
                  );
                })}
              </div>
              {allowUsdTiers && (
              <div className="grid grid-cols-3 gap-1.5">
                {([...USD_TIERS] as DiceTier[]).map((tier) => {
                  const stats = tierStatsByTier[tier];
                  const meta = usdTierLabel(Number(tier));
                  const isActive = tier === selectedTier;
                  return (
                    <button
                      key={tier}
                      onClick={() => { onTierChange?.(tier); onClose(); }}
                      className={`rounded-xl border px-2 py-2 text-left space-y-0.5 transition-all active:scale-[0.97] ${
                        isActive
                          ? "bg-blue-50 border-blue-300 shadow-sm"
                          : "bg-white border-slate-100 hover:border-blue-200"
                      }`}
                    >
                      <span className={`text-[10px] font-bold block ${isActive ? "text-blue-600" : "text-slate-600"}`}>
                        {meta}
                        {isActive && <span className="ml-1 text-[7px] text-blue-500 font-bold">●</span>}
                      </span>
                      <p className="text-[8px] text-slate-400">
                        {stats?.roundsResolved ?? 0} done
                      </p>
                    </button>
                  );
                })}
              </div>
              )}
            </div>

            {/* Recent rounds */}
            {lastRoundEntries.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wide">Your recent rounds</p>
                <div className="space-y-1.5">
                  {lastRoundEntries.map(({ tier, round }) => {
                    if (!round) return null;
                    const isUsd = isUsdTierType(tier as DiceTier);
                    const iWon = round.winner && myAddress &&
                      round.winner.toLowerCase() === myAddress.toLowerCase();
                    const tierLabel = isUsd
                      ? usdTierLabel(Number(tier))
                      : `${tier}`;
                    const potMiles = isUsd ? 0 : Number(tier) * 6;
                    return (
                      <div
                        key={tier}
                        className={`rounded-2xl border px-3 py-2.5 flex items-center gap-3 ${
                          iWon
                            ? "bg-[#238D9D]/5 border-[#238D9D]/20"
                            : "bg-white border-slate-100"
                        }`}
                      >
                        {/* Winning number bubble */}
                        <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
                          <div className={`h-8 w-8 rounded-full flex items-center justify-center text-white text-[12px] font-extrabold shadow-sm ${
                            NUMBER_COLORS[round.winningNumber ?? 0] ?? "bg-slate-400"
                          }`}>
                            {round.winningNumber ?? "?"}
                          </div>
                          <span className="text-[7px] text-slate-400 font-medium leading-none">rolled</span>
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-[12px] font-bold ${iWon ? "text-[#238D9D]" : "text-slate-800"}`}>
                              {iWon ? "You won 🎉" : `${shortAddress(round.winner ?? "")}`}
                            </p>
                            {iWon && <span className="text-[9px] bg-[#238D9D]/10 text-[#238D9D] px-1.5 py-0.5 rounded-full font-semibold">W</span>}
                          </div>
                          <p className="text-[9px] text-slate-400">
                            {isUsd ? "USDT" : <><Image src={akibaMilesSymbol} alt="M" className="h-2 w-2 inline" /> Miles</>}
                            {" "}{tierLabel} · Round #{round.roundId.toString()}
                            {round.myNumber != null && ` · Your #${round.myNumber}`}
                          </p>
                        </div>

                        {/* Pot value */}
                        <div className="flex-shrink-0 text-right">
                          {isUsd ? (
                            <p className="text-[11px] font-bold text-blue-600">
                              ${((Number(tier) / 100) * 6).toFixed(2)}
                            </p>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-slate-700">
                              <Image src={akibaMilesSymbolAlt} alt="" width={11} height={11} className="inline" />
                              <span>{potMiles}</span>
                            </span>
                          )}
                          <p className="text-[8px] text-slate-400">pot</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <p className="text-[9px] text-slate-300 text-center pb-1">
              Stats read directly from the smart contract
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
