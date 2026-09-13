export const DAILY_SEND_QUEST_ID = "383eaa90-75aa-4592-a783-ad9126e8f04d";
export const SEVEN_DAY_STREAK_QUEST_ID = "6ddc811a-1a4d-4e57-871d-836f07486531";

const DAY_MS = 86_400_000;
const LOOKBACK_DAYS = 14;
const ACTIVE_MINT_JOB_STATUSES = ["pending", "processing", "completed"];

type SupabaseLike = {
  from: (table: string) => any;
};

type ClaimedAtRow = {
  claimed_at: unknown;
};

type MintJobRow = {
  status?: string | null;
  payload?: {
    kind?: string;
    userAddress?: string;
    questId?: string;
    claimedAt?: unknown;
  } | null;
};

export type SevenDaySendStreakStatus = {
  id: "seven_day_send";
  title: string;
  description: string;
  cadence: "daily";
  currentStreak: number;
  longestStreak: number;
  target: 7;
  progress: number;
  daysLeft: number;
  claimable: boolean;
  rewardClaimed: boolean;
  broken: boolean;
  breaksAt: string | null;
  lastScopeKey: string | null;
  completedCurrentScope: boolean;
};

export function addUtcDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function utcStartOfDay(date: Date) {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  return start;
}

export function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function utcDayEnd(date: Date) {
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCMilliseconds(-1);
  return end;
}

function parseDateKey(key: string) {
  return new Date(`${key}T00:00:00.000Z`);
}

export function dailyBreaksAt(lastScopeKey: string, todayKey: string): string | null {
  const last = parseDateKey(lastScopeKey);
  const today = parseDateKey(todayKey);
  const daysSince = Math.floor((today.getTime() - last.getTime()) / DAY_MS);

  if (daysSince === 0) return utcDayEnd(addUtcDays(today, 1)).toISOString();
  if (daysSince === 1) return utcDayEnd(today).toISOString();
  return null;
}

export function normalizeClaimedDate(value: unknown): string | null {
  if (value == null) return null;
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
}

export function runLengthEndingAt(claimed: Set<string>, newestAllowed: Date, maxDays = LOOKBACK_DAYS) {
  let count = 0;
  for (let i = 0; i < maxDays; i++) {
    const key = dateKey(addUtcDays(newestAllowed, -i));
    if (!claimed.has(key)) break;
    count++;
  }
  return count;
}

function addNormalizedDate(days: Set<string>, allowed: Set<string>, value: unknown) {
  const key = normalizeClaimedDate(value);
  if (key && allowed.has(key)) {
    days.add(key);
  }
}

export function collectClaimedDays(opts: {
  engagementRows?: ClaimedAtRow[] | null;
  mintJobRows?: MintJobRow[] | null;
  allowedDates: Set<string>;
  questId: string;
  userAddress: string;
}) {
  const days = new Set<string>();
  const userLc = opts.userAddress.toLowerCase();

  for (const row of opts.engagementRows ?? []) {
    addNormalizedDate(days, opts.allowedDates, row.claimed_at);
  }

  for (const row of opts.mintJobRows ?? []) {
    if (!row.status || !ACTIVE_MINT_JOB_STATUSES.includes(row.status)) continue;

    const payload = row.payload;
    if (!payload || payload.kind !== "daily_engagement") continue;
    if (payload.questId !== opts.questId) continue;
    if (payload.userAddress && payload.userAddress.toLowerCase() !== userLc) continue;

    addNormalizedDate(days, opts.allowedDates, payload.claimedAt);
  }

  return days;
}

export function buildSevenDaySendStreakStatusFromDays(opts: {
  claimedDays: Set<string>;
  rewardClaimedDays: Set<string>;
  today?: Date;
}): SevenDaySendStreakStatus {
  const today = utcStartOfDay(opts.today ?? new Date());
  const todayKey = dateKey(today);
  const dates = Array.from({ length: LOOKBACK_DAYS }, (_, i) => dateKey(addUtcDays(today, -i)));
  const lastSeven = dates.slice(0, 7);
  const newestAllowed = opts.claimedDays.has(todayKey) ? today : addUtcDays(today, -1);
  const currentStreak = runLengthEndingAt(opts.claimedDays, newestAllowed);
  const lastClaimed = dates.find((d) => opts.claimedDays.has(d)) ?? null;
  const sevenRewardClaimed = lastSeven.some((day) => opts.rewardClaimedDays.has(day));
  const progress = Math.min(7, currentStreak);

  return {
    id: "seven_day_send",
    title: "7-day send streak",
    description: "Claim the daily send quest 7 days in a row.",
    cadence: "daily",
    currentStreak,
    longestStreak: currentStreak,
    target: 7,
    progress,
    daysLeft: Math.max(0, 7 - progress),
    claimable: currentStreak >= 7 && !sevenRewardClaimed,
    rewardClaimed: sevenRewardClaimed,
    broken: currentStreak === 0,
    breaksAt: lastClaimed ? dailyBreaksAt(lastClaimed, todayKey) : null,
    lastScopeKey: lastClaimed,
    completedCurrentScope: opts.claimedDays.has(todayKey),
  };
}

async function fetchQuestDays(opts: {
  supabase: SupabaseLike;
  userAddress: string;
  questId: string;
  oldestKey: string;
  tomorrowKey: string;
  oldestCreatedAt: string;
  allowedDates: Set<string>;
}) {
  const userLc = opts.userAddress.toLowerCase();
  const [engagements, mintJobs] = await Promise.all([
    opts.supabase
      .from("daily_engagements")
      .select("claimed_at")
      .eq("user_address", userLc)
      .eq("quest_id", opts.questId)
      .gte("claimed_at", opts.oldestKey)
      .lt("claimed_at", opts.tomorrowKey),
    opts.supabase
      .from("minipoint_mint_jobs")
      .select("status, payload")
      .eq("user_address", userLc)
      .in("status", ACTIVE_MINT_JOB_STATUSES)
      .contains("payload", { kind: "daily_engagement", questId: opts.questId })
      .gte("created_at", opts.oldestCreatedAt),
  ]);

  if (engagements.error) throw engagements.error;
  if (mintJobs.error) throw mintJobs.error;

  return collectClaimedDays({
    engagementRows: engagements.data,
    mintJobRows: mintJobs.data,
    allowedDates: opts.allowedDates,
    questId: opts.questId,
    userAddress: userLc,
  });
}

export async function buildSevenDaySendStreakStatus(
  supabase: SupabaseLike,
  userAddress: string,
  now = new Date(),
) {
  const today = utcStartOfDay(now);
  const tomorrow = addUtcDays(today, 1);
  const dates = Array.from({ length: LOOKBACK_DAYS }, (_, i) => dateKey(addUtcDays(today, -i)));
  const allowedDates = new Set(dates);
  const oldestKey = dates[dates.length - 1];
  const tomorrowKey = dateKey(tomorrow);
  const oldestCreatedAt = `${oldestKey}T00:00:00.000Z`;

  const [claimedDays, rewardClaimedDays] = await Promise.all([
    fetchQuestDays({
      supabase,
      userAddress,
      questId: DAILY_SEND_QUEST_ID,
      oldestKey,
      tomorrowKey,
      oldestCreatedAt,
      allowedDates,
    }),
    fetchQuestDays({
      supabase,
      userAddress,
      questId: SEVEN_DAY_STREAK_QUEST_ID,
      oldestKey,
      tomorrowKey,
      oldestCreatedAt,
      allowedDates,
    }),
  ]);

  return buildSevenDaySendStreakStatusFromDays({
    claimedDays,
    rewardClaimedDays,
    today,
  });
}
