// Canonical-only daily leaderboard for Pass skill games.
// walletless-pass-skill-games-spec.md §12 — simplified for Pass v1: every
// Pass session is already canonical-owned by construction, so this reads
// skill_game_sessions grouped by canonical_id directly. It deliberately does
// NOT attempt the full cross-source merge (resolving legacy wallet-keyed
// React rows into the same ranking) — that's real additional work belonging
// with a dedicated leaderboard-unification pass, not blocking the core
// walletless play loop.

import { createAdminClient } from "@/lib/supabase/admin";
import type { GameType } from "@akiba/skill-games/core";

export type LeaderboardEntry = {
  rank: number;
  canonicalId: string;
  displayName: string;
  score: number;
  isYou: boolean;
};

function nairobiDayBounds(): { start: string; end: string } {
  const nowNairobi = new Date(Date.now() + 3 * 60 * 60 * 1000); // EAT = UTC+3
  const y = nowNairobi.getUTCFullYear();
  const m = nowNairobi.getUTCMonth();
  const d = nowNairobi.getUTCDate();
  const startUtc = new Date(Date.UTC(y, m, d) - 3 * 60 * 60 * 1000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { start: startUtc.toISOString(), end: endUtc.toISOString() };
}

function shortAlias(canonicalId: string): string {
  return `Player ${canonicalId.replace(/-/g, "").slice(0, 4).toUpperCase()}`;
}

export async function getDailyLeaderboard(
  gameType: GameType,
  viewerCanonicalId: string | null,
  limit = 5
): Promise<LeaderboardEntry[]> {
  const { start, end } = nairobiDayBounds();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("skill_game_sessions")
    .select("canonical_id, score")
    .eq("game_type", gameType)
    .eq("accepted", true)
    .not("canonical_id", "is", null)
    .gte("created_at", start)
    .lt("created_at", end)
    .order("score", { ascending: false })
    .limit(500);
  if (error) {
    console.error("[games/leaderboard] query failed:", error.message);
    return [];
  }

  const bestByCanonical = new Map<string, number>();
  for (const row of (data ?? []) as { canonical_id: string; score: number }[]) {
    const current = bestByCanonical.get(row.canonical_id);
    if (current === undefined || row.score > current) bestByCanonical.set(row.canonical_id, row.score);
  }

  return [...bestByCanonical.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([canonicalId, score], index) => ({
      rank: index + 1,
      canonicalId,
      displayName: canonicalId === viewerCanonicalId ? "You" : shortAlias(canonicalId),
      score,
      isYou: canonicalId === viewerCanonicalId,
    }));
}
