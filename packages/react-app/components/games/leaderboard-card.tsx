"use client";

import { useState, useEffect } from "react";
import { useLeaderboard } from "@/hooks/games/useLeaderboard";
import { useWeeklyLeaderboard } from "@/hooks/games/useWeeklyLeaderboard";
import { useWeb3 } from "@/contexts/useWeb3";
import { GAME_CONFIGS } from "@/lib/games/config";
import type { GameType, LeaderboardEntry } from "@/lib/games/types";
import { Trophy, Medal, CalendarBlank, Gift, Timer } from "@phosphor-icons/react";

/** ms until Sunday 23:59:59 UTC (= next Mon 00:00:00 UTC) */
function msUntilWeekClose() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun…6=Sat
  const daysUntilMonday = day === 0 ? 1 : 8 - day; // days from now until next Monday
  const nextMonday = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(),
    now.getUTCDate() + daysUntilMonday,
  ));
  return nextMonday.getTime() - now.getTime();
}

function useWeekCountdown() {
  const [ms, setMs] = useState(msUntilWeekClose);
  useEffect(() => {
    const id = setInterval(() => setMs(msUntilWeekClose()), 1000);
    return () => clearInterval(id);
  }, []);

  const totalSeconds = Math.floor(ms / 1000);
  const days  = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins  = Math.floor((totalSeconds % 3600) / 60);
  const secs  = totalSeconds % 60;

  if (days > 1) return `${days}d left`;
  if (days === 1) return `1d ${String(hours).padStart(2,"0")}:${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  return `${String(hours).padStart(2,"0")}:${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
}

const RANK_ICONS = [
  <Trophy key="1" size={13} weight="fill" className="text-yellow-500" />,
  <Medal key="2" size={13} weight="fill" className="text-slate-400" />,
  <Medal key="3" size={13} weight="fill" className="text-orange-400" />,
];

const WEEKLY_PRIZES: Record<number, string> = { 1: "$5", 2: "$3", 3: "$2" };

function shortAddress(addr: string) {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function displayName(entry: LeaderboardEntry) {
  if (entry.username) return `@${entry.username}`;
  return shortAddress(entry.walletAddress);
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

function EntryRow({
  entry,
  rank,
  isWeekly,
  isYou,
}: {
  entry:    LeaderboardEntry;
  rank:     number;
  isWeekly: boolean;
  isYou:    boolean;
}) {
  const prize = isWeekly ? WEEKLY_PRIZES[rank] : null;

  return (
    <div className={`flex items-center gap-3 px-4 py-3 ${isYou ? "bg-[#F0FDFF]" : ""}`}>
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#F5F5F5]">
        {rank <= 3 ? RANK_ICONS[rank - 1] : (
          <span className="text-xs font-bold text-[#525252]">#{rank}</span>
        )}
      </div>
      <div className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${avatarBg(entry.walletAddress)}`}>
        {entry.walletAddress.slice(2, 4).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-[#1A1A1A] truncate">{displayName(entry)}</p>
          {isYou && (
            <span className="text-[10px] font-bold text-[#238D9D] bg-[#238D9D1A] rounded-full px-1.5 py-0.5 flex-shrink-0">You</span>
          )}
        </div>
        {!entry.username && (
          <p className="text-xs text-[#817E7E] truncate">{shortAddress(entry.walletAddress)}</p>
        )}
      </div>
      <div className="text-right flex-shrink-0">
        <p className="text-sm font-bold text-[#238D9D]">{entry.score} pts</p>
        {prize && (
          <span className="inline-flex items-center gap-0.5 mt-0.5 border border-dashed border-[#B7791F55] rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-[#B7791F]">
            est. {prize}
          </span>
        )}
      </div>
    </div>
  );
}

export function LeaderboardCard({ gameType }: { gameType: GameType }) {
  const [tab, setTab] = useState<"daily" | "weekly">("daily");
  const { address } = useWeb3();
  const weekCountdown = useWeekCountdown();
  const daily  = useLeaderboard(gameType);
  const weekly = useWeeklyLeaderboard(gameType);
  const config = GAME_CONFIGS[gameType];

  const isLoading = tab === "daily" ? daily.isLoading : weekly.isLoading;
  const entries   = tab === "daily" ? daily.entries   : weekly.entries;
  const myBest    = tab === "daily" ? daily.myBest    : weekly.myBest;

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
            Today
          </button>
          <button
            type="button"
            onClick={() => setTab("weekly")}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all ${
              tab === "weekly" ? "bg-[#238D9D] text-white" : "text-[#817E7E]"
            }`}
          >
            <Gift size={11} />
            This week
          </button>
        </div>
      </div>

      {/* Weekly prize header */}
      {tab === "weekly" && config.weeklyPrizeUsd > 0 && (
        <div className="mx-4 mt-3 mb-1 rounded-xl bg-gradient-to-r from-[#FFF6D8] to-[#FFF0C0] border border-[#B7791F22] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Gift size={15} weight="fill" className="text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#B7791F]">Weekly prize pool — ${config.weeklyPrizeUsd}</p>
              <p className="text-xs text-[#B7791F]/80">1st $5 · 2nd $3 · 3rd $2</p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 bg-[#B7791F18] rounded-full px-2 py-1">
              <Timer size={10} weight="fill" className="text-[#B7791F]" />
              <span className="text-[10px] font-bold text-[#B7791F] tabular-nums">{weekCountdown}</span>
            </div>
          </div>
        </div>
      )}

      {/* Entries */}
      <div className="divide-y divide-[#F5F5F5]">
        {entries.slice(0, 5).map((entry) => (
          <EntryRow
            key={`${entry.rank}-${entry.walletAddress}`}
            entry={entry}
            rank={entry.rank}
            isWeekly={tab === "weekly"}
            isYou={!!address && entry.walletAddress.toLowerCase() === address.toLowerCase()}
          />
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

      {/* My best footer */}
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
