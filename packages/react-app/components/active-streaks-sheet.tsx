"use client";

import { useCallback, useEffect, useState } from "react";
import { Fire, WarningCircle, CheckCircle, ArrowRight } from "@phosphor-icons/react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type StreakStatus = {
  id: string;
  title: string;
  description: string;
  cadence: "daily" | "weekly";
  currentStreak: number;
  longestStreak: number;
  target: number;
  progress: number;
  daysLeft: number;
  claimable: boolean;
  rewardClaimed: boolean;
  broken: boolean;
  breaksAt: string | null;
  lastScopeKey: string | null;
  completedCurrentScope: boolean;
};

type StreakStatusResponse = {
  streaks: StreakStatus[];
  activeCount: number;
  claimableCount: number;
};

// ── helpers ──────────────────────────────────────────────────────────────────

function compactDuration(toIso: string | null) {
  if (!toIso) return null;
  const ms = new Date(toIso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const minutesTotal = Math.ceil(ms / 60_000);
  const days = Math.floor(minutesTotal / 1440);
  const hours = Math.floor((minutesTotal % 1440) / 60);
  const minutes = minutesTotal % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function isBreakingUrgent(streak: StreakStatus) {
  if (streak.broken || streak.claimable || !streak.breaksAt) return false;
  return new Date(streak.breaksAt).getTime() - Date.now() < 6 * 60 * 60 * 1000;
}

// Maps streak id → the quest route to claim it
const STREAK_CLAIM_ROUTE: Record<string, string> = {
  seven_day_send: "/earn",
  balance_10: "/earn",
  balance_30: "/earn",
  balance_100: "/earn",
  topup: "/earn",
};

// Human-readable action label per streak
const STREAK_ACTION: Record<string, string> = {
  seven_day_send: "Claim 7-day reward",
  balance_10: "Claim $10 streak",
  balance_30: "Claim $30 streak",
  balance_100: "Claim $100 streak",
  topup: "Claim top-up streak",
};

// Miles for 7-day reward (shown directly in sheet)
const SEVEN_DAY_REWARD_MILES = 200;

// ── Next-best-action banner ───────────────────────────────────────────────────

function NextBestAction({
  streaks,
  onClose,
  onClaim7Day,
  claiming7Day,
}: {
  streaks: StreakStatus[];
  onClose: () => void;
  onClaim7Day: () => void;
  claiming7Day: boolean;
}) {
  // Priority: claimable 7-day > urgent break > any claimable > nothing
  const claimable7day = streaks.find((s) => s.id === "seven_day_send" && s.claimable);
  const urgentBreaking = streaks
    .filter((s) => isBreakingUrgent(s))
    .sort((a, b) => {
      const at = a.breaksAt ? new Date(a.breaksAt).getTime() : Infinity;
      const bt = b.breaksAt ? new Date(b.breaksAt).getTime() : Infinity;
      return at - bt;
    })[0];
  const anyClaimable = streaks.find((s) => s.claimable);

  if (claimable7day) {
    return (
      <div className="rounded-2xl border border-[#238D9D]/30 bg-[#E6FAFA] px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#238D9D]">7-day streak complete!</p>
          <p className="text-xs text-[#238D9D]/80 mt-0.5">Claim your {SEVEN_DAY_REWARD_MILES} AkibaMiles now.</p>
        </div>
        <button
          type="button"
          onClick={onClaim7Day}
          disabled={claiming7Day}
          className="shrink-0 rounded-xl bg-[#238D9D] px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          {claiming7Day ? "Claiming…" : `Claim ${SEVEN_DAY_REWARD_MILES} Miles`}
        </button>
      </div>
    );
  }

  if (urgentBreaking) {
    const timeLeft = compactDuration(urgentBreaking.breaksAt);
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-amber-700">
            {urgentBreaking.currentStreak}-day streak breaks in {timeLeft}
          </p>
          <p className="text-xs text-amber-600 mt-0.5">{urgentBreaking.title}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 flex items-center gap-1 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-white"
        >
          Claim now <ArrowRight size={12} />
        </button>
      </div>
    );
  }

  if (anyClaimable) {
    return (
      <div className="rounded-2xl border border-[#238D9D]/20 bg-[#F0FDFF] px-4 py-3 flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-[#238D9D]">You have a streak reward to claim!</p>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 flex items-center gap-1 rounded-xl bg-[#238D9D] px-3 py-2 text-xs font-semibold text-white"
        >
          Go claim <ArrowRight size={12} />
        </button>
      </div>
    );
  }

  return null;
}

// ── Streak card ───────────────────────────────────────────────────────────────

function StreakCard({
  streak,
  onClose,
  onClaim7Day,
  claiming7Day,
  claim7DayResult,
}: {
  streak: StreakStatus;
  onClose: () => void;
  onClaim7Day: () => void;
  claiming7Day: boolean;
  claim7DayResult: { success: boolean; points?: number } | null;
}) {
  const urgent = isBreakingUrgent(streak);
  const breaksIn = compactDuration(streak.breaksAt);

  // Progress label
  let progressLabel: string;
  if (streak.id === "seven_day_send") {
    if (streak.claimable) progressLabel = "7/7 days complete";
    else progressLabel = `${streak.progress}/7 days · ${streak.daysLeft} more to unlock ${SEVEN_DAY_REWARD_MILES} Miles`;
  } else {
    const milesLeft = streak.daysLeft;
    if (streak.broken) progressLabel = `Best streak: ${streak.longestStreak}`;
    else if (milesLeft > 0) progressLabel = `${streak.currentStreak} day${streak.currentStreak === 1 ? "" : "s"} · ${milesLeft} more to milestone`;
    else progressLabel = `Current: ${streak.currentStreak} · Best: ${streak.longestStreak}`;
  }

  // Status label
  let statusLabel: string;
  let statusColor: string;
  if (streak.claimable) { statusLabel = "Reward ready to claim!"; statusColor = "text-[#238D9D]"; }
  else if (streak.broken) { statusLabel = "Streak broken"; statusColor = "text-gray-400"; }
  else if (urgent) { statusLabel = `Breaks in ${breaksIn} — act now!`; statusColor = "text-amber-700"; }
  else if (streak.completedCurrentScope && streak.cadence === "weekly") {
    statusLabel = "This week complete · claim again next week";
    statusColor = "text-[#238D9D]";
  } else if (streak.completedCurrentScope) {
    statusLabel = "Today complete · claim again tomorrow";
    statusColor = "text-[#238D9D]";
  } else if (breaksIn) {
    statusLabel = `${streak.cadence === "weekly" ? "Claim this week" : "Claim today"} · breaks in ${breaksIn}`;
    statusColor = "text-[#238D9D]";
  } else { statusLabel = "Active"; statusColor = "text-[#238D9D]"; }

  return (
    <div
      className={[
        "rounded-2xl border bg-white p-4 shadow-sm",
        streak.claimable
          ? "border-[#238D9D]/30 bg-[#F0FDFF]"
          : urgent
            ? "border-amber-200 bg-amber-50"
            : "border-gray-100",
      ].join(" ")}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={[
            "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
            streak.broken ? "bg-gray-100" : streak.claimable ? "bg-[#238D9D]" : urgent ? "bg-amber-100" : "bg-[#238D9D]/10",
          ].join(" ")}
        >
          {streak.claimable ? (
            <CheckCircle size={20} weight="duotone" color="#FFFFFF" />
          ) : urgent ? (
            <WarningCircle size={20} weight="duotone" color="#D97706" />
          ) : (
            <Fire size={20} weight="duotone" color={streak.broken ? "#9CA3AF" : "#238D9D"} />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900">{streak.title}</h3>
            <span
              className={[
                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                streak.claimable ? "bg-[#238D9D] text-white"
                  : urgent ? "bg-amber-400 text-white"
                    : streak.broken ? "bg-gray-100 text-gray-500"
                      : "bg-[#238D9D]/10 text-[#238D9D]",
              ].join(" ")}
            >
              {streak.cadence}
            </span>
          </div>

          <p className="mt-1 text-xs text-gray-500">{streak.description}</p>
          <p className="mt-2 text-xs font-semibold text-gray-800">{progressLabel}</p>
          <p className={`mt-1 text-xs ${statusColor}`}>{statusLabel}</p>

          {/* 7-day progress bar */}
          {streak.id === "seven_day_send" && !streak.claimable && (
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-[#238D9D] transition-all"
                style={{ width: `${Math.min(100, (streak.progress / 7) * 100)}%` }}
              />
            </div>
          )}

          {/* 7-day claim button inline */}
          {streak.id === "seven_day_send" && streak.claimable && (
            <div className="mt-3">
              {claim7DayResult?.success ? (
                <p className="text-xs font-semibold text-[#238D9D]">
                  ✓ {claim7DayResult.points ?? SEVEN_DAY_REWARD_MILES} Miles claimed!
                </p>
              ) : (
                <button
                  type="button"
                  onClick={onClaim7Day}
                  disabled={claiming7Day}
                  className="w-full rounded-xl bg-[#238D9D] py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {claiming7Day ? "Claiming…" : `Claim ${SEVEN_DAY_REWARD_MILES} AkibaMiles`}
                </button>
              )}
            </div>
          )}

          {/* CTA for urgent/claimable non-7-day streaks */}
          {streak.id !== "seven_day_send" && (streak.claimable || urgent) && !streak.broken && (
            <button
              type="button"
              onClick={onClose}
              className={[
                "mt-3 flex w-full items-center justify-center gap-1 rounded-xl py-2 text-xs font-semibold",
                urgent
                  ? "bg-amber-500 text-white"
                  : "bg-[#238D9D] text-white",
              ].join(" ")}
            >
              {STREAK_ACTION[streak.id] ?? "Go to Earn"} <ArrowRight size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main sheet ────────────────────────────────────────────────────────────────

const SEVEN_DAY_STREAK_QUEST_ID = "6ddc811a-1a4d-4e57-871d-836f07486531";

export function ActiveStreaksSheet({
  open,
  onOpenChange,
  onSummaryChange,
  userAddress,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSummaryChange?: (summary: { activeCount: number; claimableCount: number; urgentCount: number }) => void;
  userAddress?: string;
}) {
  const [data, setData] = useState<StreakStatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming7Day, setClaiming7Day] = useState(false);
  const [claim7DayResult, setClaim7DayResult] = useState<{ success: boolean; points?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/streaks/status", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const json: StreakStatusResponse = await res.json();
      setData(json);
      const urgentCount = (json.streaks ?? []).filter(isBreakingUrgent).length;
      onSummaryChange?.({
        activeCount: json.activeCount ?? 0,
        claimableCount: json.claimableCount ?? 0,
        urgentCount,
      });
    } catch {
      setData({ streaks: [], activeCount: 0, claimableCount: 0 });
      onSummaryChange?.({ activeCount: 0, claimableCount: 0, urgentCount: 0 });
    } finally {
      setLoading(false);
    }
  }, [onSummaryChange]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (open) { load(); setClaim7DayResult(null); } }, [open, load]);

  const handle7DayClaim = useCallback(async () => {
    if (!userAddress || claiming7Day) return;
    setClaiming7Day(true);
    try {
      const res = await fetch("/api/quests/seven_day_streak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress, questId: SEVEN_DAY_STREAK_QUEST_ID }),
      });
      const json = await res.json();
      setClaim7DayResult({ success: json.success, points: json.points });
      if (json.success) {
        // Refresh streak data after claim
        await load();
      }
    } catch {
      setClaim7DayResult({ success: false });
    } finally {
      setClaiming7Day(false);
    }
  }, [userAddress, claiming7Day, load]);

  const streaks = data?.streaks ?? [];
  const sorted = [...streaks].sort((a, b) => {
    // claimable first, then urgent, then active, then broken
    if (a.claimable !== b.claimable) return a.claimable ? -1 : 1;
    const aUrgent = isBreakingUrgent(a);
    const bUrgent = isBreakingUrgent(b);
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    if (a.broken !== b.broken) return a.broken ? 1 : -1;
    return b.currentStreak - a.currentStreak;
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[88dvh] overflow-y-auto rounded-t-3xl bg-[#F8FFFE] px-4 pb-6 pt-5">
        <SheetHeader className="pr-8 text-left">
          <SheetTitle className="flex items-center gap-2">
            <Fire size={22} weight="duotone" color="#238D9D" />
            Streaks
          </SheetTitle>
          <SheetDescription>
            Claim on time to keep active streaks. Timers use the app's UTC claim day.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          {/* Next-best-action banner */}
          {!loading && streaks.length > 0 && (
            <NextBestAction
              streaks={streaks}
              onClose={() => onOpenChange(false)}
              onClaim7Day={handle7DayClaim}
              claiming7Day={claiming7Day}
            />
          )}

          {loading && sorted.length === 0 ? (
            <div className="rounded-2xl border border-gray-100 bg-white p-5 text-sm text-gray-500">
              Loading streaks…
            </div>
          ) : sorted.length > 0 ? (
            sorted.map((streak) => (
              <StreakCard
                key={streak.id}
                streak={streak}
                onClose={() => onOpenChange(false)}
                onClaim7Day={handle7DayClaim}
                claiming7Day={claiming7Day}
                claim7DayResult={streak.id === "seven_day_send" ? claim7DayResult : null}
              />
            ))
          ) : (
            <div className="rounded-2xl border border-gray-100 bg-white p-5 text-sm text-gray-500">
              No streaks yet. Complete a streak quest from Earn to start one.
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
