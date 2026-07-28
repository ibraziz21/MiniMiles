// Shared ISO-8601 week ("YYYY-Www") helper — previously duplicated
// byte-for-byte in app/api/games/leaderboard/route.ts,
// lib/games/mock-verifier.ts, and app/api/admin/weekly-payout-snapshot/
// route.ts. Consolidated here for the new sponsored_game_played webhook's
// `sgp:{wallet}:{game_type}:{iso_week}` idempotency key, which needs the
// same week boundary as the existing weekly-leaderboard logic and as
// Postgres's `to_char(date, 'IYYY-"W"IW')` (the enqueue trigger in
// sql/sponsored_games.sql uses that format specifier for the same reason).
//
// No "use client"/"use server" directive — this must stay importable from
// both mock-verifier.ts (client component) and server route handlers.
export function isoWeek(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}
