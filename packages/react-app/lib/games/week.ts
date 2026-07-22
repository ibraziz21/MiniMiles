// ISO-week helpers shared by weekly leaderboard settlement + campaign lookup.

/** ISO week string for a date, e.g. '2026-W30'. */
export function isoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** [from, to) UTC range for an ISO week string. */
export function weekRange(isoWeekStr: string): { from: string; to: string } {
  const [yearStr, weekStr] = isoWeekStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekStr, 10);
  // ISO week 1 is the week containing the first Thursday.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (jan4Day - 1) * 86_400_000 + (week - 1) * 7 * 86_400_000);
  const nextMonday = new Date(monday.getTime() + 7 * 86_400_000);
  return { from: monday.toISOString(), to: nextMonday.toISOString() };
}

/** The most recently *closed* ISO week (i.e. last week, relative to now). */
export function lastClosedWeek(now = new Date()): string {
  const currentMondayIso = weekRange(isoWeek(now)).from;
  const beforeMonday = new Date(new Date(currentMondayIso).getTime() - 1);
  return isoWeek(beforeMonday);
}

export const WEEK_RE = /^\d{4}-W\d{2}$/;
