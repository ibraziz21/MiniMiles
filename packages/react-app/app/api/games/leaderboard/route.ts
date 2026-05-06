/**
 * GET /api/games/leaderboard?gameType=rule_tap&period=daily&wallet=0x...
 *
 * period=daily  → best score per wallet for UTC today
 * period=weekly → best score per wallet for the current ISO week (Mon–Sun)
 *
 * Returns:
 *   { entries: LeaderboardEntry[], myBest: LeaderboardEntry | null }
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import type { GameType, LeaderboardEntry, WeeklyLeaderboardEntry } from "@/lib/games/types";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

function utcTodayRange() {
  const now  = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to   = new Date(from.getTime() + 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}

function currentWeekRange() {
  const now    = new Date();
  const day    = now.getUTCDay(); // 0=Sun
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((day + 6) % 7)));
  const sunday = new Date(monday.getTime() + 7 * 86_400_000);
  return { from: monday.toISOString(), to: sunday.toISOString() };
}

function isoWeek(date = new Date()): string {
  const d      = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo    = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// Prize map for weekly top 3
const WEEKLY_PRIZE: Record<number, number> = { 1: 5, 2: 3, 3: 2 };

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const gameType = searchParams.get("gameType") as GameType | null;
  const period   = searchParams.get("period") ?? "daily";
  const wallet   = searchParams.get("wallet")?.toLowerCase() ?? null;

  if (!gameType || !["rule_tap", "memory_flip"].includes(gameType)) {
    return NextResponse.json({ error: "invalid gameType" }, { status: 400 });
  }

  const range = period === "weekly" ? currentWeekRange() : utcTodayRange();

  // Only count sessions that have been confirmed on-chain (settle_tx_hash set)
  const { data, error } = await supabase
    .from("skill_game_sessions")
    .select("wallet_address, score, reward_miles, reward_stable, created_at")
    .eq("game_type", gameType)
    .eq("accepted", true)
    .not("settle_tx_hash", "is", null)
    .gte("created_at", range.from)
    .lt("created_at", range.to)
    .order("score", { ascending: false });

  if (error) {
    console.error("[leaderboard] supabase error", error);
    return NextResponse.json({ error: "db-error" }, { status: 500 });
  }

  // Best score per wallet
  const bestByWallet = new Map<string, typeof data[0]>();
  for (const row of (data ?? [])) {
    const key = row.wallet_address.toLowerCase();
    const existing = bestByWallet.get(key);
    if (!existing || row.score > existing.score) {
      bestByWallet.set(key, row);
    }
  }

  // Sort: score desc, then earlier play first
  const sorted = Array.from(bestByWallet.values()).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  const top = sorted.slice(0, 20);

  // Batch-fetch usernames for all wallets in the result set
  const wallets = top.map((r) => r.wallet_address.toLowerCase());
  const usernameMap = new Map<string, string>();
  if (wallets.length > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("user_address, username")
      .in("user_address", wallets);
    for (const u of (users ?? [])) {
      if (u.username) usernameMap.set(u.user_address.toLowerCase(), u.username);
    }
  }

  const entries: (LeaderboardEntry | WeeklyLeaderboardEntry)[] = top
    .map((row, i) => {
      const rank = i + 1;
      const base: LeaderboardEntry = {
        rank,
        walletAddress: row.wallet_address,
        username:      usernameMap.get(row.wallet_address.toLowerCase()) ?? null,
        score:         row.score,
        elapsedMs:     0,
        rewardMiles:   row.reward_miles,
        rewardStable:  Number(row.reward_stable),
        playedAt:      row.created_at,
      };
      if (period === "weekly") {
        return {
          ...base,
          week:       isoWeek(),
          prizeUsd:   WEEKLY_PRIZE[rank] ?? 0,
          prizeMiles: 0,
        } as WeeklyLeaderboardEntry;
      }
      return base;
    });

  const myBest = wallet
    ? (entries.find((e) => e.walletAddress.toLowerCase() === wallet) ?? null)
    : null;

  return NextResponse.json({ entries, myBest }, {
    headers: { "Cache-Control": "no-store" },
  });
}
