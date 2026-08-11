"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Trophy, Medal, CalendarBlank, Gift, ArrowClockwise } from "@phosphor-icons/react";
import type { GameType } from "../core/types";
import type { LeaderboardEntry, LeaderboardResponse } from "../client/transport";
import { MilesAmount } from "./miles-amount";
import { cn } from "./ui/cn";

// Host-neutral leaderboard widget (skill-games-leaderboards-spec.md §5.2).
// Deliberately imports nothing host-specific — no Web3, Supabase, Next
// routing, or analytics SDK — and renders no merchant, voucher, prize,
// sponsor, countdown, or prize-zone content. That absence is what makes the
// "no prize promotion at launch" invariant structural rather than a UI
// convention each host has to remember to follow.

const RANK_ICONS: ReactNode[] = [
  <Trophy key="1" size={13} weight="fill" className="text-yellow-500" />,
  <Medal key="2" size={13} weight="fill" className="text-slate-400" />,
  <Medal key="3" size={13} weight="fill" className="text-orange-400" />,
];

function avatarBg(key: string) {
  const palette = [
    "bg-purple-200 text-purple-700",
    "bg-teal-200 text-teal-700",
    "bg-orange-200 text-orange-700",
    "bg-pink-200 text-pink-700",
    "bg-blue-200 text-blue-700",
  ];
  return palette[key ? key.charCodeAt(key.length - 1) % palette.length : 0];
}

function initials(displayName: string) {
  const stripped = displayName.replace(/^@/, "");
  return stripped.slice(0, 2).toUpperCase();
}

function Row({ entry, milesIcon }: { entry: LeaderboardEntry; milesIcon: ReactNode }) {
  return (
    <div className={cn("flex items-center gap-3 px-4 py-3", entry.isYou && "bg-[#F0FDFF]")}>
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-[#F5F5F5]">
        {entry.rank <= 3 ? RANK_ICONS[entry.rank - 1] : (
          <span className="text-xs font-bold text-[#525252]">#{entry.rank}</span>
        )}
      </div>
      <div className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold", avatarBg(entry.playerKey))}>
        {initials(entry.displayName)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-semibold text-[#1A1A1A]">{entry.displayName}</p>
          {entry.isYou && (
            <span className="flex-shrink-0 rounded-full bg-[#238D9D1A] px-1.5 py-0.5 text-[10px] font-bold text-[#238D9D]">You</span>
          )}
        </div>
        {entry.elapsedMs != null && (
          <p className="text-xs text-[#817E7E]">{(entry.elapsedMs / 1000).toFixed(1)}s</p>
        )}
      </div>
      <div className="flex flex-shrink-0 flex-col items-end gap-0.5">
        <p className="text-sm font-bold text-[#238D9D]">{entry.score} pts</p>
        {entry.rewardMiles > 0 && (
          <span className="text-[10px] text-[#817E7E]">
            <MilesAmount value={entry.rewardMiles} icon={milesIcon} />
          </span>
        )}
      </div>
    </div>
  );
}

export function LeaderboardCard({
  gameType,
  fetchLeaderboard,
  milesIcon,
  viewerKey,
  track,
  className,
}: {
  gameType: GameType;
  /** Host-supplied loader — the component never calls a specific endpoint itself. */
  fetchLeaderboard: (gameType: GameType, scope: "daily" | "weekly") => Promise<LeaderboardResponse>;
  milesIcon: ReactNode;
  /** Opaque viewer identifier for telemetry only — row highlighting comes from `entry.isYou`. */
  viewerKey?: string | null;
  track?: (event: string, properties?: Record<string, unknown>) => void;
  className?: string;
}) {
  const [scope, setScope] = useState<"daily" | "weekly">("daily");
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  const load = useCallback(async (nextScope: "daily" | "weekly") => {
    setStatus("loading");
    try {
      const response = await fetchLeaderboard(gameType, nextScope);
      setData(response);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [fetchLeaderboard, gameType]);

  useEffect(() => { load(scope); }, [load, scope]);

  function selectTab(nextScope: "daily" | "weekly") {
    setScope(nextScope);
    track?.("leaderboard_scope_switch", { game: gameType, scope: nextScope, viewerKey });
  }

  const entries = data?.entries.slice(0, 5) ?? [];
  const myBest = data?.myBest ?? null;
  const showPinnedRow = myBest != null && !entries.some((e) => e.playerKey === myBest.playerKey);

  return (
    <section className={cn("overflow-hidden rounded-2xl border border-[#F0F0F0] bg-white shadow-sm", className)}>
      <div className="flex items-center justify-between border-b border-[#F5F5F5] px-4 py-3">
        <div className="flex items-center gap-2">
          <Trophy size={15} weight="fill" className="text-amber-500" />
          <h2 className="text-sm font-bold">Leaderboard</h2>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => selectTab("daily")}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
              scope === "daily" ? "bg-[#238D9D] text-white" : "text-[#817E7E]"
            )}
          >
            <CalendarBlank size={11} />
            Today
          </button>
          <button
            type="button"
            onClick={() => selectTab("weekly")}
            className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-all",
              scope === "weekly" ? "bg-[#238D9D] text-white" : "text-[#817E7E]"
            )}
          >
            <Gift size={11} />
            This week
          </button>
        </div>
      </div>

      {status === "loading" && (
        <div className="px-4 py-6 text-center text-xs text-[#817E7E]">Loading…</div>
      )}

      {status === "error" && (
        <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
          <p className="text-xs text-[#817E7E]">Couldn&apos;t load the leaderboard.</p>
          <button
            type="button"
            onClick={() => load(scope)}
            className="flex items-center gap-1 rounded-full bg-[#238D9D1A] px-3 py-1 text-xs font-semibold text-[#238D9D]"
          >
            <ArrowClockwise size={12} weight="bold" />
            Retry
          </button>
        </div>
      )}

      {status === "ready" && (
        <>
          <div className="divide-y divide-[#F5F5F5]">
            {entries.map((entry) => (
              <Row key={entry.playerKey} entry={entry} milesIcon={milesIcon} />
            ))}
            {entries.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-[#817E7E]">
                {scope === "weekly" ? "No entries this week yet. Play to claim your spot!" : "No entries yet. Be the first to play today!"}
              </div>
            )}
          </div>

          {showPinnedRow && myBest && (
            <div className="border-t border-dashed border-[#F0F0F0]">
              <Row entry={myBest} milesIcon={milesIcon} />
            </div>
          )}
        </>
      )}
    </section>
  );
}
