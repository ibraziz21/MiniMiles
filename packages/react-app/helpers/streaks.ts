// src/helpers/streaks.ts
import { createClient } from "@supabase/supabase-js";
import { claimQueuedDailyReward } from "@/lib/minipointQueue";

const {
  SUPABASE_URL = "",
  SUPABASE_SERVICE_KEY = "",
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.warn("[streaks] Missing one or more env vars");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

export type StreakScope = "daily" | "weekly";

type StreakClaimResult =
  | { ok: true; txHash?: string; scopeKey: string; queued?: boolean; currentStreak: number; longestStreak: number }
  | { ok: false; code: "already"; scopeKey: string; currentStreak: number; longestStreak: number }
  | { ok: false; code: "error"; scopeKey: string; message?: string; currentStreak: number; longestStreak: number };

/**
 * Compute a scope key for logging in DB:
 *  - daily:  "YYYY-MM-DD"
 *  - weekly: "YYYY-Www" (ISO week)
 */
export function scopeKeyFor(scope: StreakScope, now = new Date()): string {
  if (scope === "daily") {
    return now.toISOString().slice(0, 10);
  }

  // Weekly → ISO week string
  const tmp = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const dayNum = tmp.getUTCDay() || 7; // Sunday=7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function previousScopeKeyFor(scope: StreakScope, key: string): string {
  if (scope === "daily") {
    const d = new Date(`${key}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  const [yearPart, weekPart] = key.split("-W");
  const year = Number(yearPart);
  const week = Number(weekPart);

  if (week > 1) {
    return `${year}-W${String(week - 1).padStart(2, "0")}`;
  }

  const lastDayPrevYear = new Date(Date.UTC(year - 1, 11, 31));
  return scopeKeyFor("weekly", lastDayPrevYear);
}

async function getExistingStreak(userAddress: string, questId: string) {
  const { data, error } = await supabase
    .from("streaks")
    .select("scope, current_streak, longest_streak, last_scope_key")
    .eq("user_address", userAddress.toLowerCase())
    .eq("quest_id", questId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as
    | {
        scope: StreakScope | null;
        current_streak: number | null;
        longest_streak: number | null;
        last_scope_key: string | null;
      }
    | null;
}

async function upsertStreak(opts: {
  userAddress: string;
  questId: string;
  scope: StreakScope;
  scopeKey: string;
}) {
  const existing = await getExistingStreak(opts.userAddress, opts.questId);
  const expectedPreviousKey = previousScopeKeyFor(opts.scope, opts.scopeKey);
  const userLc = opts.userAddress.toLowerCase();

  let currentStreak = 1;
  const previousCurrent = Number(existing?.current_streak ?? 0);
  const previousLongest = Number(existing?.longest_streak ?? 0);
  const lastScopeKey = existing?.last_scope_key ?? null;

  if (lastScopeKey === opts.scopeKey) {
    return {
      currentStreak: previousCurrent,
      longestStreak: Math.max(previousLongest, previousCurrent),
    };
  }

  if (lastScopeKey === expectedPreviousKey) {
    currentStreak = previousCurrent + 1;
  }

  const longestStreak = Math.max(previousLongest, currentStreak);

  if (existing) {
    const { error } = await supabase
      .from("streaks")
      .update({
        scope: opts.scope,
        current_streak: currentStreak,
        longest_streak: longestStreak,
        last_scope_key: opts.scopeKey,
      })
      .eq("user_address", userLc)
      .eq("quest_id", opts.questId);

    if (error) throw error;
  } else {
    const { error } = await supabase.from("streaks").insert({
      user_address: userLc,
      quest_id: opts.questId,
      scope: opts.scope,
      current_streak: currentStreak,
      longest_streak: longestStreak,
      last_scope_key: opts.scopeKey,
    });

    if (error) throw error;
  }

  return { currentStreak, longestStreak };
}

export async function refreshStreakState(opts: {
  userAddress: string;
  questId: string;
  scope: StreakScope;
}) {
  const scopeKey = scopeKeyFor(opts.scope);
  const existing = await getExistingStreak(opts.userAddress, opts.questId);
  if (!existing) {
    return { currentStreak: 0, longestStreak: 0 };
  }

  const expectedPreviousKey = previousScopeKeyFor(opts.scope, scopeKey);
  const lastScopeKey = existing.last_scope_key ?? null;
  const currentStreak = Number(existing.current_streak ?? 0);
  const longestStreak = Number(existing.longest_streak ?? 0);

  if (!lastScopeKey || lastScopeKey === scopeKey || lastScopeKey === expectedPreviousKey) {
    return { currentStreak, longestStreak };
  }

  if (currentStreak === 0) {
    return { currentStreak, longestStreak };
  }

  const { error } = await supabase
    .from("streaks")
    .update({ current_streak: 0 })
    .eq("user_address", opts.userAddress.toLowerCase())
    .eq("quest_id", opts.questId);

  if (error) {
    throw error;
  }

  return { currentStreak: 0, longestStreak };
}

/**
 * Generic helper:
 *  - enforce "once per scope" restriction via daily_engagements
 *  - enqueue MiniMiles mint and let the queue processor serialize sends
 *  - log row in daily_engagements after the mint succeeds
 */
export async function claimStreakReward(opts: {
  userAddress: string;
  questId: string;
  points: number;
  scope: StreakScope;
  label?: string; // for logging / analytics
}): Promise<StreakClaimResult> {
  const { userAddress, questId, points, scope, label } = opts;

  const key = scopeKeyFor(scope);
  const result = await claimQueuedDailyReward({
    userAddress,
    questId,
    points,
    scopeKey: key,
    reason: label ? `streak:${label}` : `streak:${questId}`,
  });

  if (!result.ok && result.code === "already") {
    const streak = await refreshStreakState({ userAddress, questId, scope });
    return {
      ok: false,
      code: "already",
      scopeKey: key,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
    };
  }

  if (!result.ok) {
    const streak = await refreshStreakState({ userAddress, questId, scope });
    return {
      ok: false,
      code: "error",
      scopeKey: key,
      message: result.message,
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
    };
  }

  const streak = await upsertStreak({
    userAddress,
    questId,
    scope,
    scopeKey: key,
  });

  return {
    ok: true,
    txHash: result.txHash,
    queued: result.queued,
    scopeKey: key,
    currentStreak: streak.currentStreak,
    longestStreak: streak.longestStreak,
  };
}
