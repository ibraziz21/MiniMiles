import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

// ── helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

export function todayISO() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

// ── Overview KPIs ─────────────────────────────────────────────────────────────

export async function getTotalUsers() {
  const { count } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true });
  return count ?? 0;
}

export async function getDAU() {
  const { count } = await supabase
    .from("daily_engagements")
    .select("*", { count: "exact", head: true })
    .gte("claimed_at", todayISO())
    .not("user_address", "is", null);
  // Distinct users via a workaround — count distinct in supabase via rpc or approximate
  return count ?? 0;
}

export async function getNewUsersLast30Days() {
  // Proxy: users who made their first mint job in the last 30 days
  const { data } = await supabase
    .from("minipoint_mint_jobs")
    .select("user_address, created_at")
    .eq("reason", "new-user-signup")
    .gte("created_at", daysAgo(30))
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function getTotalMilesMinted() {
  const { data } = await supabase
    .from("minipoint_mint_jobs")
    .select("points")
    .eq("status", "completed");
  return (data ?? []).reduce((s, r) => s + (r.points ?? 0), 0);
}

export async function getMilesLast30Days() {
  const { data } = await supabase
    .from("minipoint_mint_jobs")
    .select("points, created_at, reason")
    .eq("status", "completed")
    .gte("created_at", daysAgo(30))
    .order("created_at", { ascending: true });
  return data ?? [];
}

export async function getPendingMintJobs() {
  const { data, count } = await supabase
    .from("minipoint_mint_jobs")
    .select("user_address, points, reason, created_at", { count: "exact" })
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(20);
  return { rows: data ?? [], total: count ?? 0 };
}

// ── Users ─────────────────────────────────────────────────────────────────────

export async function getUserRegistrationTrend(days = 30) {
  const { data } = await supabase
    .from("minipoint_mint_jobs")
    .select("created_at")
    .eq("reason", "new-user-signup")
    .gte("created_at", daysAgo(days))
    .order("created_at", { ascending: true });

  // Bucket by day
  const byDay: Record<string, number> = {};
  for (const row of data ?? []) {
    const day = row.created_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  return Object.entries(byDay).map(([date, count]) => ({ date, count }));
}

export async function getTopEarners(limit = 20) {
  const { data } = await supabase
    .from("minipoint_mint_jobs")
    .select("user_address, points")
    .eq("status", "completed");

  const byWallet: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.user_address) continue;
    byWallet[row.user_address] = (byWallet[row.user_address] ?? 0) + (row.points ?? 0);
  }

  const sorted = Object.entries(byWallet)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([wallet, miles]) => ({ wallet, miles }));

  // Hydrate usernames
  const wallets = sorted.map((r) => r.wallet);
  const { data: users } = await supabase
    .from("users")
    .select("wallet_address, username")
    .in("wallet_address", wallets);

  const nameMap: Record<string, string> = {};
  for (const u of users ?? []) nameMap[u.wallet_address] = u.username ?? "";

  return sorted.map((r, i) => ({
    rank: i + 1,
    wallet: r.wallet,
    username: nameMap[r.wallet] ?? "",
    miles: r.miles,
  }));
}

export async function getProfileCompletionBuckets() {
  const { data } = await supabase
    .from("users")
    .select("username, email, phone, twitter_handle, avatar_url, bio, country");

  const fields = ["username", "email", "phone", "twitter_handle", "avatar_url", "bio", "country"];
  const buckets = { "0-25": 0, "26-50": 0, "51-75": 0, "76-100": 0 };

  for (const user of data ?? []) {
    const filled = fields.filter((f) => !!(user as any)[f]).length;
    const pct = Math.round((filled / fields.length) * 100);
    if (pct <= 25) buckets["0-25"]++;
    else if (pct <= 50) buckets["26-50"]++;
    else if (pct <= 75) buckets["51-75"]++;
    else buckets["76-100"]++;
  }

  return Object.entries(buckets).map(([range, count]) => ({ range, count }));
}

// ── Games ─────────────────────────────────────────────────────────────────────

export async function getGameSessionVolume(days = 30) {
  const { data } = await supabase
    .from("skill_game_sessions")
    .select("created_at, game_type, accepted")
    .gte("created_at", daysAgo(days))
    .order("created_at", { ascending: true });

  const byDay: Record<string, { rule_tap: number; memory_flip: number; rejected: number }> = {};
  for (const row of data ?? []) {
    const day = row.created_at.slice(0, 10);
    if (!byDay[day]) byDay[day] = { rule_tap: 0, memory_flip: 0, rejected: 0 };
    if (!row.accepted) { byDay[day].rejected++; continue; }
    if (row.game_type === "rule_tap") byDay[day].rule_tap++;
    else if (row.game_type === "memory_flip") byDay[day].memory_flip++;
  }
  return Object.entries(byDay).map(([date, v]) => ({ date, ...v }));
}

export async function getGameScoreDistribution() {
  const { data } = await supabase
    .from("skill_game_sessions")
    .select("game_type, score")
    .eq("accepted", true)
    .limit(5000);

  const rt: number[] = [];
  const mf: number[] = [];
  for (const row of data ?? []) {
    if (row.game_type === "rule_tap") rt.push(row.score);
    else mf.push(row.score);
  }

  function buckets(scores: number[], size: number) {
    const b: Record<string, number> = {};
    for (const s of scores) {
      const key = `${Math.floor(s / size) * size}`;
      b[key] = (b[key] ?? 0) + 1;
    }
    return Object.entries(b)
      .sort((a, b) => +a[0] - +b[0])
      .map(([score, count]) => ({ score: +score, count }));
  }

  return { rule_tap: buckets(rt, 2), memory_flip: buckets(mf, 50) };
}

export async function getAntiFlagRates() {
  const { data } = await supabase
    .from("skill_game_sessions")
    .select("anti_abuse_flags, game_type")
    .not("anti_abuse_flags", "eq", "{}");

  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    for (const flag of (row.anti_abuse_flags ?? []) as string[]) {
      counts[flag] = (counts[flag] ?? 0) + 1;
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([flag, count]) => ({ flag, count }));
}

export async function getGameLeaderboard(gameType: string, limit = 20) {
  const { data } = await supabase
    .from("skill_game_sessions")
    .select("wallet_address, score, reward_miles, created_at")
    .eq("game_type", gameType)
    .eq("accepted", true)
    .order("score", { ascending: false })
    .limit(limit);

  const wallets = [...new Set((data ?? []).map((r) => r.wallet_address))];
  const { data: users } = await supabase
    .from("users")
    .select("wallet_address, username")
    .in("wallet_address", wallets);
  const nameMap: Record<string, string> = {};
  for (const u of users ?? []) nameMap[u.wallet_address] = u.username ?? "";

  return (data ?? []).map((r, i) => ({
    rank: i + 1,
    wallet: r.wallet_address,
    username: nameMap[r.wallet_address] ?? "",
    score: r.score,
    rewardMiles: r.reward_miles,
    playedAt: r.created_at,
  }));
}

export async function getTodayGameStats() {
  const { data } = await supabase
    .from("skill_game_sessions")
    .select("game_type, accepted, reward_miles")
    .gte("created_at", todayISO());

  let total = 0, accepted = 0, milesAwarded = 0;
  const byType: Record<string, number> = {};
  for (const r of data ?? []) {
    total++;
    byType[r.game_type] = (byType[r.game_type] ?? 0) + 1;
    if (r.accepted) { accepted++; milesAwarded += r.reward_miles ?? 0; }
  }
  return { total, accepted, rejected: total - accepted, milesAwarded, byType };
}

// ── Quests / Earn ─────────────────────────────────────────────────────────────

export async function getQuestCompletionRates(days = 14) {
  const { data } = await supabase
    .from("daily_engagements")
    .select("quest_id, claimed_at, points_awarded")
    .gte("claimed_at", daysAgo(days));

  const byQuest: Record<string, { count: number; points: number }> = {};
  for (const row of data ?? []) {
    const id = row.quest_id ?? "unknown";
    if (!byQuest[id]) byQuest[id] = { count: 0, points: 0 };
    byQuest[id].count++;
    byQuest[id].points += row.points_awarded ?? 0;
  }
  return Object.entries(byQuest)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([questId, v]) => ({ questId, ...v }));
}

export async function getQuestDailyTrend(days = 14) {
  const { data } = await supabase
    .from("daily_engagements")
    .select("claimed_at")
    .gte("claimed_at", daysAgo(days))
    .order("claimed_at", { ascending: true });

  const byDay: Record<string, number> = {};
  for (const row of data ?? []) {
    const day = row.claimed_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  return Object.entries(byDay).map(([date, count]) => ({ date, count }));
}

export async function getStreakHealth() {
  const { data } = await supabase
    .from("streaks")
    .select("quest_id, current_streak, longest_streak");

  const byQuest: Record<string, { total: number; sum: number; max: number }> = {};
  for (const row of data ?? []) {
    const q = row.quest_id;
    if (!byQuest[q]) byQuest[q] = { total: 0, sum: 0, max: 0 };
    byQuest[q].total++;
    byQuest[q].sum += row.current_streak ?? 0;
    byQuest[q].max = Math.max(byQuest[q].max, row.longest_streak ?? 0);
  }
  return Object.entries(byQuest).map(([questId, v]) => ({
    questId,
    avgStreak: v.total > 0 ? +(v.sum / v.total).toFixed(1) : 0,
    maxStreak: v.max,
    activeUsers: v.total,
  }));
}

export async function getMintJobsByReason(days = 30) {
  const { data } = await supabase
    .from("minipoint_mint_jobs")
    .select("reason, points, status")
    .gte("created_at", daysAgo(days));

  const byReason: Record<string, { completed: number; pending: number; points: number }> = {};
  for (const row of data ?? []) {
    const r = (row.reason as string).split(":")[0] ?? "unknown";
    if (!byReason[r]) byReason[r] = { completed: 0, pending: 0, points: 0 };
    if (row.status === "completed") { byReason[r].completed++; byReason[r].points += row.points ?? 0; }
    else byReason[r].pending++;
  }
  return Object.entries(byReason)
    .sort((a, b) => b[1].points - a[1].points)
    .map(([reason, v]) => ({ reason, ...v }));
}

// ── Vault ─────────────────────────────────────────────────────────────────────

export async function getVaultTVL() {
  const { data } = await supabase
    .from("vault_positions")
    .select("balance_usdt");
  return (data ?? []).reduce((s, r) => s + parseFloat(r.balance_usdt ?? "0"), 0);
}

export async function getVaultTVLTrend(days = 30) {
  const { data } = await supabase
    .from("vault_events")
    .select("event_type, amount_usdt, created_at")
    .gte("created_at", daysAgo(days))
    .order("created_at", { ascending: true });

  // Cumulative running net from this window
  const byDay: Record<string, number> = {};
  for (const row of data ?? []) {
    const day = row.created_at.slice(0, 10);
    const amt = parseFloat(row.amount_usdt ?? "0");
    const delta = row.event_type === "deposit" ? amt : -amt;
    byDay[day] = (byDay[day] ?? 0) + delta;
  }
  return Object.entries(byDay).map(([date, netFlow]) => ({ date, netFlow }));
}

export async function getTopVaultDepositors(limit = 20) {
  const { data } = await supabase
    .from("vault_positions")
    .select("wallet_address, balance_usdt, updated_at")
    .order("balance_usdt", { ascending: false })
    .limit(limit);

  const wallets = (data ?? []).map((r) => r.wallet_address);
  const { data: users } = await supabase
    .from("users")
    .select("wallet_address, username")
    .in("wallet_address", wallets);
  const nameMap: Record<string, string> = {};
  for (const u of users ?? []) nameMap[u.wallet_address] = u.username ?? "";

  return (data ?? []).map((r, i) => ({
    rank: i + 1,
    wallet: r.wallet_address,
    username: nameMap[r.wallet_address] ?? "",
    balanceUsdt: parseFloat(r.balance_usdt ?? "0"),
    updatedAt: r.updated_at,
  }));
}

export async function getVaultFlowBreakdown(days = 30) {
  const { data } = await supabase
    .from("vault_events")
    .select("event_type, amount_usdt")
    .gte("created_at", daysAgo(days));

  let deposits = 0, withdrawals = 0, txDeposits = 0, txWithdrawals = 0;
  for (const row of data ?? []) {
    const amt = parseFloat(row.amount_usdt ?? "0");
    if (row.event_type === "deposit") { deposits += amt; txDeposits++; }
    else { withdrawals += amt; txWithdrawals++; }
  }
  return { deposits, withdrawals, netFlow: deposits - withdrawals, txDeposits, txWithdrawals };
}
