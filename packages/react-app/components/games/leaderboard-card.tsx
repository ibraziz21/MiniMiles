"use client";

import { useState } from "react";
import { useLeaderboard } from "@/hooks/games/useLeaderboard";
import { useWeeklyLeaderboard } from "@/hooks/games/useWeeklyLeaderboard";
import { useWeeklyCampaign } from "@/hooks/games/useWeeklyCampaign";
import { useWeekCountdown } from "@/hooks/games/useWeekCountdown";
import { useWeb3 } from "@/contexts/useWeb3";
import type { GameType } from "@/lib/games/types";
import { Trophy, CalendarBlank, Gift, Timer } from "@phosphor-icons/react";
import { EntryRow } from "@/components/games/leaderboard-shared";

export function LeaderboardCard({ gameType }: { gameType: GameType }) {
  const [tab, setTab] = useState<"daily" | "weekly">("daily");
  const { address } = useWeb3();
  const weekCountdown = useWeekCountdown();
  const daily  = useLeaderboard(gameType);
  const weekly = useWeeklyLeaderboard(gameType);
  const { campaign } = useWeeklyCampaign();
  const sponsored = campaign?.merchant && campaign.gameTypes.includes(gameType) ? campaign : null;

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

      {/* Weekly countdown header — sponsored campaign banner when active (spec §2) */}
      {tab === "weekly" && (
        <div className="mx-4 mt-3 mb-1 rounded-xl bg-gradient-to-r from-[#FFF6D8] to-[#FFF0C0] border border-[#B7791F22] px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Gift size={15} weight="fill" className="text-amber-500 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#B7791F]">
                {sponsored
                  ? <>This week&apos;s prizes by <span className="font-bold">{sponsored.merchant!.name}</span></>
                  : "This week's leaderboard"}
              </p>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 bg-[#B7791F18] rounded-full px-2 py-1">
              <Timer size={10} weight="fill" className="text-[#B7791F]" />
              <span className="text-[10px] font-bold text-[#B7791F] tabular-nums">{weekCountdown}</span>
            </div>
          </div>
          {sponsored && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {sponsored.tiers.slice(0, 3).map((t) => (
                <span
                  key={t.rank}
                  className="rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-bold text-[#B7791F] ring-1 ring-[#B7791F22]"
                >
                  {t.rank === 1 ? "🏆" : t.rank === 2 ? "🥈" : "🥉"} {t.label}
                </span>
              ))}
              <span className="text-[10px] text-[#B7791F]/80">
                on up to KES {(sponsored.tiers[0]?.spendCapKes ?? 0).toLocaleString()}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Entries */}
      <div className="divide-y divide-[#F5F5F5]">
        {entries.slice(0, 5).map((entry) => (
          <EntryRow
            key={`${entry.rank}-${entry.walletAddress}`}
            entry={entry}
            rank={entry.rank}
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
