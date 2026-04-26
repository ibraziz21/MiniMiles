"use client";

import { useState } from "react";
import { useLeaderboard } from "@/hooks/games/useLeaderboard";
import { useWeeklyLeaderboard } from "@/hooks/games/useWeeklyLeaderboard";
import { GAME_CONFIGS } from "@/lib/games/config";
import type { GameType, LeaderboardEntry, WeeklyLeaderboardEntry } from "@/lib/games/types";
import { Trophy, Medal, Gift, CalendarBlank } from "@phosphor-icons/react";
import { MilesAmount } from "./miles-amount";

const RANK_ICONS = [
  <Trophy key="1" size={13} weight="fill" className="text-yellow-500" />,
  <Medal key="2" size={13} weight="fill" className="text-slate-400" />,
  <Medal key="3" size={13} weight="fill" className="text-orange-400" />,
];

function shortAddress(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function avatarBg(addr: string) {
  const palette = [
    "bg-purple-200 text-purple-700",
    "bg-teal-200 text-teal-700",
    "bg-orange-200 text-orange-700",
    "bg-pink-200 text-pink-700",
    "bg-blue-200 text-blue-700",
  ];
  return palette[addr ? addr.charCodeAt(2) % palette.length : 0];
}

function EntryRow({ entry, rank }: { entry: LeaderboardEntry; rank: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#F5F5F5]">
        {rank <= 3 ? RANK_ICONS[rank - 1] : (
          <span className="text-xs font-bold text-[#525252]">#{rank}</span>
        )}
      </div>
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarBg(entry.walletAddress)}`}>
        {entry.walletAddress.slice(2, 4).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-[#1A1A1A] truncate">{shortAddress(entry.walletAddress)}</p>
        <p className="text-xs text-[#817E7E]">
          {(entry.elapsedMs / 1000).toFixed(1)}s
          {entry.mistakes != null ? ` · ${entry.mistakes} err` : ""}
        </p>
      </div>
      <p className="text-sm font-bold text-[#238D9D]">{entry.score}</p>
    </div>
  );
}

function WeeklyPrizeBanner({ gameType }: { gameType: GameType }) {
  const config = GAME_CONFIGS[gameType];
  const hasPrize = config.weeklyPrizeUsd > 0 || config.weeklyPrizeMiles > 0;
  if (!hasPrize) return null;

  return (
    <div className="mx-4 mb-3 flex items-center gap-2.5 rounded-xl bg-gradient-to-r from-[#FFF6D8] to-[#FFF0C0] border border-[#B7791F22] px-3 py-2.5">
      <Gift size={18} weight="fill" className="text-amber-500 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-[#B7791F]">Weekly prize pool</p>
        <p className="text-xs text-[#525252] font-poppins flex items-center gap-1 flex-wrap">
          Top 3 win{" "}
          {config.weeklyPrizeUsd > 0 && <span className="font-semibold text-[#B7791F]">${config.weeklyPrizeUsd} USDT</span>}
          {config.weeklyPrizeUsd > 0 && config.weeklyPrizeMiles > 0 && " + "}
          {config.weeklyPrizeMiles > 0 && <MilesAmount value={config.weeklyPrizeMiles} size={12} className="font-semibold text-[#B7791F]" />}
        </p>
      </div>
    </div>
  );
}

export function LeaderboardCard({ gameType }: { gameType: GameType }) {
  const [tab, setTab] = useState<"daily" | "weekly">("daily");
  const daily = useLeaderboard(gameType);
  const weekly = useWeeklyLeaderboard(gameType);

  const isLoading = tab === "daily" ? daily.isLoading : weekly.isLoading;
  const entries = tab === "daily" ? daily.entries : weekly.entries;
  const myBest = tab === "daily" ? daily.myBest : weekly.myBest;

  return (
    <section className="rounded-2xl border border-[#F0F0F0] bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#F5F5F5]">
        <div className="flex items-center gap-2">
          <Trophy size={15} weight="fill" className="text-amber-500" />
          <h2 className="text-sm font-bold">Leaderboard</h2>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTab("daily")}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
              tab === "daily" ? "bg-[#238D9D] text-white" : "text-[#817E7E]"
            }`}
          >
            <CalendarBlank size={11} />
            Daily
          </button>
          <button
            type="button"
            onClick={() => setTab("weekly")}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
              tab === "weekly" ? "bg-[#238D9D] text-white" : "text-[#817E7E]"
            }`}
          >
            <Gift size={11} />
            Weekly
          </button>
        </div>
      </div>

      {/* Weekly prize banner — only on weekly tab */}
      {tab === "weekly" && (
        <div className="pt-3">
          <WeeklyPrizeBanner gameType={gameType} />
        </div>
      )}

      {/* Entries */}
      <div className="divide-y divide-[#F5F5F5]">
        {entries.slice(0, 5).map((entry) => (
          <EntryRow key={`${entry.rank}-${entry.walletAddress}`} entry={entry} rank={entry.rank} />
        ))}
        {entries.length === 0 && !isLoading && (
          <div className="px-4 py-6 text-center text-sm text-[#817E7E] font-poppins">
            {tab === "weekly"
              ? "No entries this week yet. Play to claim your spot!"
              : "No entries yet. Be the first to play today!"}
          </div>
        )}
        {isLoading && (
          <div className="px-4 py-4 text-center text-xs text-[#817E7E]">Loading…</div>
        )}
      </div>

      {/* My best */}
      <div className="border-t border-[#F5F5F5] bg-[#F7FEFF] px-4 py-3 flex items-center justify-between">
        <p className="text-xs text-[#817E7E] font-poppins">
          {tab === "weekly" ? "My best this week" : "My best today"}
        </p>
        <p className="text-sm font-bold text-[#238D9D]">
          {myBest ? `${myBest.score} pts` : "—"}
        </p>
      </div>
    </section>
  );
}
