export const PASS_ANALYTICS_MAX_DAYS = 366;

export type PassAnalyticsRange = {
  from: string;
  to: string;
  days: number;
};

export type PassAnalytics = {
  total_passes: number;
  signups_today: number;
  signups_yesterday: number;
  signups_7_days: number;
  signups_30_days: number;
  period_signups: number;
  period_onboarding_seen: number;
  daily: Array<{ date: string; signups: number; onboarding_seen: number }>;
  sources: Array<{ source: string; signups: number }>;
};

function isoDateInNairobi(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function defaultPassAnalyticsRange(now = new Date()): PassAnalyticsRange {
  const to = isoDateInNairobi(now);
  return { from: shiftIsoDate(to, -29), to, days: 30 };
}

export function validatePassAnalyticsRange(
  from: string,
  to: string,
): { ok: true; value: PassAnalyticsRange } | { ok: false; error: string } {
  if (!isIsoDate(from) || !isIsoDate(to)) {
    return { ok: false, error: "Use valid dates in YYYY-MM-DD format." };
  }

  const days = Math.round(
    (new Date(`${to}T12:00:00Z`).getTime() - new Date(`${from}T12:00:00Z`).getTime()) /
      86_400_000,
  ) + 1;

  if (days < 1) return { ok: false, error: "The start date must be on or before the end date." };
  if (days > PASS_ANALYTICS_MAX_DAYS) {
    return { ok: false, error: `Choose a range of ${PASS_ANALYTICS_MAX_DAYS} days or fewer.` };
  }
  return { ok: true, value: { from, to, days } };
}

export function passAnalyticsUtcBounds(range: PassAnalyticsRange) {
  return {
    startsAt: new Date(`${range.from}T00:00:00+03:00`).toISOString(),
    endsAt: new Date(`${shiftIsoDate(range.to, 1)}T00:00:00+03:00`).toISOString(),
  };
}

export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
