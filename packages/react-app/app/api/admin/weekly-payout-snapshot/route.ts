/**
 * GET /api/admin/weekly-payout-snapshot?secret=<ADMIN_QUEUE_SECRET>&week=2025-W16
 *
 * Returns the top 3 per game for the given ISO week (defaults to current week).
 * Use this to know who to pay manually at week close.
 *
 * week param format: YYYY-Www  e.g. 2025-W16
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const ADMIN_SECRET = process.env.ADMIN_QUEUE_SECRET ?? "";

const PRIZES: Record<number, number> = { 1: 5, 2: 3, 3: 2 };
const GAME_TYPES = ["rule_tap", "memory_flip"] as const;

function isAuthorized(req: Request): boolean {
  if (!ADMIN_SECRET) return false;
  const bearer = req.headers.get("authorization");
  if (bearer === `Bearer ${ADMIN_SECRET}`) return true;
  return new URL(req.url).searchParams.get("secret") === ADMIN_SECRET;
}

function isoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function weekRange(isoWeekStr: string): { from: string; to: string } {
  const [yearStr, weekStr] = isoWeekStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  // ISO week 1 is the week containing the first Thursday
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000 + (week - 1) * 7 * 86_400_000);
  const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);
  return { from: monday.toISOString(), to: nextMonday.toISOString() };
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const week = searchParams.get("week") ?? isoWeek();

  if (!/^\d{4}-W\d{2}$/.test(week)) {
    return NextResponse.json({ error: "invalid week format, use YYYY-Www" }, { status: 400 });
  }

  const range = weekRange(week);
  const results: Record<string, unknown[]> = {};

  for (const gameType of GAME_TYPES) {
    const { data, error } = await supabase
      .from("skill_game_sessions")
      .select("wallet_address, score, created_at")
      .eq("game_type", gameType)
      .eq("accepted", true)
      .gte("created_at", range.from)
      .lt("created_at", range.to)
      .order("score", { ascending: false });

    if (error) {
      return NextResponse.json({ error: `db error for ${gameType}` }, { status: 500 });
    }

    // Best score per wallet
    const bestByWallet = new Map<string, { wallet_address: string; score: number; created_at: string }>();
    for (const row of (data ?? [])) {
      const key = row.wallet_address.toLowerCase();
      const existing = bestByWallet.get(key);
      if (!existing || row.score > existing.score) {
        bestByWallet.set(key, row);
      }
    }

    const sorted = Array.from(bestByWallet.values()).sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    });

    const top3 = sorted.slice(0, 3);

    // Fetch usernames
    const wallets = top3.map((r) => r.wallet_address.toLowerCase());
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

    results[gameType] = top3.map((row, i) => {
      const rank = i + 1;
      return {
        rank,
        walletAddress: row.wallet_address,
        username: usernameMap.get(row.wallet_address.toLowerCase()) ?? null,
        score: row.score,
        prizeUsd: PRIZES[rank] ?? 0,
      };
    });
  }

  return NextResponse.json({
    week,
    range,
    payouts: results,
    totalUsd: Object.values(results).flat().reduce((sum, e: unknown) => sum + ((e as { prizeUsd: number }).prizeUsd ?? 0), 0),
  });
}
