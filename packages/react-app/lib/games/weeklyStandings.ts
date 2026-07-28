// Shared best-per-wallet/top-N standings logic for a game's weekly window.
// Used by the settlement route (top 3, for prize issuance) and the
// challenge page's last-week route (top 10, for display) — do not
// re-derive this a third time.

import { supabase } from "@/lib/supabaseClient";

export type WeeklyStandingRow = {
  walletAddress: string;
  score: number;
  createdAt: string;
};

export async function computeWeeklyStandings(
  gameType: string,
  from: string,
  to: string,
  limit = 10,
): Promise<WeeklyStandingRow[]> {
  const { data, error } = await supabase
    .from("skill_game_sessions")
    .select("wallet_address, score, created_at")
    .eq("game_type", gameType)
    .eq("accepted", true)
    .gte("created_at", from)
    .lt("created_at", to)
    .order("score", { ascending: false });

  if (error) throw new Error(`db error for ${gameType}: ${error.message}`);

  // Best score per wallet; ties broken by earliest achievement.
  const best = new Map<string, WeeklyStandingRow>();
  for (const row of data ?? []) {
    const key = row.wallet_address.toLowerCase();
    const existing = best.get(key);
    if (!existing || row.score > existing.score) {
      best.set(key, { walletAddress: row.wallet_address, score: row.score, createdAt: row.created_at });
    }
  }

  return Array.from(best.values())
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(0, limit);
}
