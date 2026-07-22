// GET /api/games/challenge/last-week
// Public, cached (revalidate 3600 — a closed week never changes). Returns,
// per weekly game type, the winners actually issued at settlement
// (leaderboard_prize_events + issued_vouchers.win_meta, username only — no
// wallet/location beyond the existing shortAddress fallback) and the final
// top-10 standings for that week. See docs/weekly-challenge-page-spec.md §5.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { lastClosedWeek, weekRange } from "@/lib/games/week";
import { computeWeeklyStandings, type WeeklyStandingRow } from "@/lib/games/weeklyStandings";
import { WEEKLY_GAME_TYPES } from "@/lib/games/types";

export const revalidate = 3600;

type WinnerEntry = {
  rank: number;
  walletAddress: string;
  username: string | null;
  score: number;
  prizeLabel: string | null;
};

type StandingEntry = {
  rank: number;
  walletAddress: string;
  username: string | null;
  score: number;
};

type LastWeekGame = {
  gameType: string;
  winners: WinnerEntry[];
  standings: StandingEntry[];
};

export async function GET() {
  const week = lastClosedWeek();
  const range = weekRange(week);

  const allWallets = new Set<string>();

  // ── Standings: best-per-wallet top 10 from raw sessions ──────────────────
  const standingsByGame = new Map<string, { walletAddress: string; score: number }[]>();
  for (const gameType of WEEKLY_GAME_TYPES) {
    let rows: WeeklyStandingRow[];
    try {
      rows = await computeWeeklyStandings(gameType, range.from, range.to, 10);
    } catch (e) {
      console.error("[challenge/last-week] standings", gameType, (e as Error).message);
      rows = [];
    }
    rows.forEach((r) => allWallets.add(r.walletAddress.toLowerCase()));
    standingsByGame.set(gameType, rows);
  }

  // ── Winners: what settlement actually issued ──────────────────────────────
  const { data: prizeEvents, error: peErr } = await supabase
    .from("leaderboard_prize_events")
    .select("game_type, rank, score, user_address, voucher_id")
    .eq("week", week)
    .in("game_type", WEEKLY_GAME_TYPES);

  if (peErr) {
    console.error("[challenge/last-week] prize events", peErr.message);
  }

  const voucherIds = (prizeEvents ?? []).map((p) => p.voucher_id).filter(Boolean) as string[];
  const voucherLabelMap = new Map<string, string>();
  if (voucherIds.length > 0) {
    const { data: vouchers } = await supabase
      .from("issued_vouchers")
      .select("id, win_meta")
      .in("id", voucherIds);
    for (const v of vouchers ?? []) {
      const label = (v.win_meta as { label?: string } | null)?.label;
      if (label) voucherLabelMap.set(v.id, label);
    }
  }

  (prizeEvents ?? []).forEach((p) => allWallets.add(p.user_address.toLowerCase()));

  // ── Usernames, batched across both sources ────────────────────────────────
  const usernameMap = new Map<string, string>();
  if (allWallets.size > 0) {
    const { data: users } = await supabase
      .from("users")
      .select("user_address, username")
      .in("user_address", Array.from(allWallets));
    for (const u of users ?? []) {
      if (u.username) usernameMap.set(u.user_address.toLowerCase(), u.username);
    }
  }

  const winnersByGame = new Map<string, WinnerEntry[]>();
  for (const p of prizeEvents ?? []) {
    const addrLc = p.user_address.toLowerCase();
    const entry: WinnerEntry = {
      rank: p.rank,
      walletAddress: p.user_address,
      username: usernameMap.get(addrLc) ?? null,
      score: p.score ?? 0,
      prizeLabel: p.voucher_id ? voucherLabelMap.get(p.voucher_id) ?? null : null,
    };
    const arr = winnersByGame.get(p.game_type) ?? [];
    arr.push(entry);
    winnersByGame.set(p.game_type, arr);
  }

  const games: LastWeekGame[] = WEEKLY_GAME_TYPES.map((gameType) => ({
    gameType,
    winners: (winnersByGame.get(gameType) ?? []).sort((a, b) => a.rank - b.rank),
    standings: (standingsByGame.get(gameType) ?? []).map((s, i) => ({
      rank: i + 1,
      walletAddress: s.walletAddress,
      username: usernameMap.get(s.walletAddress.toLowerCase()) ?? null,
      score: s.score,
    })),
  }));

  return NextResponse.json({ week, games });
}
