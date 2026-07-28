// A "won prize voucher" now carries one of two acquisition_source values:
// the legacy 'leaderboard_win' string the pilot invented before a real
// channel identifier existed, and 'weekly_leaderboard_challenge' — the
// actual DB channel enum (MiniMiles migration
// 045_weekly_leaderboard_channel.sql) used once settlement issues from a
// real merchant allocation via issue_voucher_from_program(). Both must be
// treated identically everywhere a "won prize" is queried or checked.
export const PRIZE_ACQUISITION_SOURCES = ["leaderboard_win", "weekly_leaderboard_challenge"] as const;

export type PrizeAcquisitionSource = (typeof PRIZE_ACQUISITION_SOURCES)[number];

export function isPrizeAcquisitionSource(value: string | null | undefined): value is PrizeAcquisitionSource {
  return !!value && (PRIZE_ACQUISITION_SOURCES as readonly string[]).includes(value);
}
