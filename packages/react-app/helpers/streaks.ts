// src/helpers/streaks.ts
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY!,
);

type StreakScope = "daily" | "weekly" | "monthly";

type ClaimStreakOpts = {
  userAddress: string;
  questId: string;
  points: number;
  scope: StreakScope;
  label: string; // e.g. "topup-streak"
};

type ClaimStreakResult = {
  ok: boolean;
  code?: "already" | "error";
  scopeKey?: string;
  currentStreak?: number;
  longestStreak?: number;
  txHash?: string | null; // if you ever attach on-chain tx
};

// ── helpers for period keys ────────────────────────────────────────

function getDailyKey(d: Date) {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getIsoWeekKey(d: Date) {
  const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // Thursday in current week decides the year.
  tmp.setUTCDate(tmp.getUTCDate() + 3 - ((tmp.getUTCDay() + 6) % 7));
  const week1 = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((tmp.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${tmp.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function getMonthlyKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function computeScopeKey(scope: StreakScope, now = new Date()): string {
  if (scope === "daily") return getDailyKey(now);
  if (scope === "weekly") return getIsoWeekKey(now);
  return getMonthlyKey(now);
}

/**
 * Very light “previous period?” check.
 * For dailies we compare date-1; for weeklies we just check key inequality and
 * assume any non-equal-previous is a reset. (Good enough for now.)
 */
function isPreviousPeriod(
  scope: StreakScope,
  prevKey: string | null,
  currentKey: string,
): boolean {
  if (!prevKey) return false;
  if (scope === "daily") {
    // prevKey === yesterday?
    const today = new Date(currentKey);
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    return prevKey === getDailyKey(yesterday);
  }
  if (scope === "weekly") {
    // naive: just ensure keys differ → if not equal, we treat it as previous
    // You can get fancy with real ISO week math if you want.
    return prevKey !== currentKey;
  }
  if (scope === "monthly") {
    const [y, m] = currentKey.split("-").map(Number);
    let prevY = y;
    let prevM = m - 1;
    if (prevM === 0) {
      prevM = 12;
      prevY -= 1;
    }
    const recomputed = `${prevY}-${String(prevM).padStart(2, "0")}`;
    return prevKey === recomputed;
  }
  return false;
}

// ── main entrypoint ────────────────────────────────────────────────

export async function claimStreakReward(
  opts: ClaimStreakOpts,
): Promise<ClaimStreakResult> {
  const { userAddress, questId, points, scope } = opts;
  const user = userAddress.toLowerCase();
  const scopeKey = computeScopeKey(scope);

  // 1) read existing row (if any)
  const { data: existing, error: fetchErr } = await supabase
    .from("streaks")
    .select("*")
    .eq("user_address", user)
    .eq("quest_id", questId)
    .eq("scope", scope)
    .maybeSingle();

  if (fetchErr && fetchErr.code !== "PGRST116") {
    console.error("[claimStreakReward] fetch error", fetchErr);
    return { ok: false, code: "error" };
  }

  if (existing && existing.last_scope_key === scopeKey) {
    // Already claimed this period
    return {
      ok: false,
      code: "already",
      scopeKey,
      currentStreak: existing.current_streak,
      longestStreak: existing.longest_streak,
    };
  }

  const prevKey = existing?.last_scope_key ?? null;
  const prevStreak = existing?.current_streak ?? 0;

  const nextStreak = isPreviousPeriod(scope, prevKey, scopeKey)
    ? prevStreak + 1
    : 1;

  const longest = Math.max(existing?.longest_streak ?? 0, nextStreak);

  // 2) upsert streak row
  const { error: upErr, data: upRow } = await supabase
    .from("streaks")
    .upsert(
      {
        user_address: user,
        quest_id: questId,
        scope,
        last_scope_key: scopeKey,
        current_streak: nextStreak,
        longest_streak: longest,
      },
      { onConflict: "user_address,quest_id,scope" },
    )
    .select()
    .maybeSingle();

  if (upErr) {
    console.error("[claimStreakReward] upsert error", upErr);
    return { ok: false, code: "error" };
  }

  // 3) award the points as usual – if you have an existing “awardPoints” helper call it here
  // await awardPoints({ userAddress: user, questId, points, label: opts.label });

  return {
    ok: true,
    scopeKey,
    currentStreak: upRow?.current_streak ?? nextStreak,
    longestStreak: upRow?.longest_streak ?? longest,
    txHash: null,
  };
}
