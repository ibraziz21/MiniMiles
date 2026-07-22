"use client";

// Up to two slim rows under Daily Challenges on home: unredeemed voucher
// value, and this week's best leaderboard rank. Hidden entirely when
// neither applies — a whisper, not a banner. See
// docs/home-page-redesign-spec.md §3.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import posthog from "posthog-js";
import { Ticket, Trophy, CaretRight } from "@phosphor-icons/react";
import { useWeeklyLeaderboard } from "@/hooks/games/useWeeklyLeaderboard";
import { useWeekCountdown } from "@/hooks/games/useWeekCountdown";
import type { GameType } from "@/lib/games/types";
import type { PrizeFeedEntry } from "@/app/api/games/prize-feed/route";

const GAME_NAMES: Record<GameType, string> = { rule_tap: "Rule Tap", memory_flip: "Memory Flip" };

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / 86_400_000) : 0;
}

function useVoucherPulse() {
  const [feed, setFeed] = useState<PrizeFeedEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/games/prize-feed")
      .then((r) => (r.ok ? r.json() : { feed: [] }))
      .then((d) => { if (!cancelled) setFeed(d.feed ?? []); })
      .catch(() => { if (!cancelled) setFeed([]); });
    return () => { cancelled = true; };
  }, []);

  return useMemo(() => {
    if (!feed) return null;
    // Both "action_needed" (unseen win) and "active" (issued, not yet used)
    // map back to a still-live voucher.status === 'issued'.
    const active = feed.filter((e) => e.status === "action_needed" || e.status === "active");
    if (active.length === 0) return null;

    const expiringSoon = active.filter((e) => {
      const d = daysLeft(e.expires_at);
      return d !== null && d <= 7;
    }).length;

    return { count: active.length, expiringSoon };
  }, [feed]);
}

function useRankPulse() {
  const ruleTap = useWeeklyLeaderboard("rule_tap");
  const memoryFlip = useWeeklyLeaderboard("memory_flip");

  const candidates = [
    { game: "rule_tap" as GameType, best: ruleTap.myBest },
    { game: "memory_flip" as GameType, best: memoryFlip.myBest },
  ].filter((c): c is { game: GameType; best: NonNullable<typeof ruleTap.myBest> } => c.best != null);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.best.rank - b.best.rank);
  return candidates[0];
}

export function ValuePulseStrip() {
  const voucherPulse = useVoucherPulse();
  const rankPulse = useRankPulse();
  const countdown = useWeekCountdown();

  const rows: string[] = [];
  if (voucherPulse) rows.push("vouchers");
  if (rankPulse) rows.push("rank");
  const rowsKey = rows.join(",");

  useEffect(() => {
    if (rows.length > 0) posthog.capture("value_pulse_impression", { rows });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowsKey]);

  if (rows.length === 0) return null;

  return (
    <div className="mx-4 mt-3 flex flex-col gap-2">
      {voucherPulse && (
        <Link
          href="/vouchers"
          onClick={() => posthog.capture("value_pulse_tap", { row: "vouchers" })}
          className="flex items-center gap-2 rounded-xl border border-[#E5ECEE] bg-white px-3.5 py-2.5 shadow-sm transition-transform active:scale-[0.99]"
        >
          <Ticket size={16} weight="duotone" className="shrink-0 text-[#238D9D]" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#0D2B30]">
            🎟 {voucherPulse.count} voucher{voucherPulse.count === 1 ? "" : "s"}
            {voucherPulse.expiringSoon > 0 ? ` · ${voucherPulse.expiringSoon} expiring soon` : ""}
          </p>
          <CaretRight size={13} weight="bold" className="shrink-0 text-[#667579]" />
        </Link>
      )}

      {rankPulse && (
        <Link
          href="/games/challenge"
          onClick={() => posthog.capture("value_pulse_tap", { row: "rank" })}
          className="flex items-center gap-2 rounded-xl border border-[#E5ECEE] bg-white px-3.5 py-2.5 shadow-sm transition-transform active:scale-[0.99]"
        >
          <Trophy size={16} weight="duotone" className="shrink-0 text-amber-500" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#0D2B30]">
            {rankPulse.best.rank > 20
              ? `🏆 You're on the ${GAME_NAMES[rankPulse.game]} board`
              : `🏆 You're #${rankPulse.best.rank} in ${GAME_NAMES[rankPulse.game]} · ${countdown} left`}
          </p>
          <CaretRight size={13} weight="bold" className="shrink-0 text-[#667579]" />
        </Link>
      )}
    </div>
  );
}
