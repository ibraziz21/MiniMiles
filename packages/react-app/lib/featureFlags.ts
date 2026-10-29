// Client-readable product flags. Kept as plain constants (not env vars) so the
// value is identical on server and client and reviewable in git history.

/**
 * Daily challenges — Miles for MiniPay wallet activity (sends, receives, tx
 * counts, Kiln holds) — are being retired. Earning now lives in the Akiba Pass
 * (real shops) and in games, so the rails are hidden app-wide while the quest
 * rows, claim routes and DB records are still in place. Flip to `true` to put
 * the UI back; the deprecation notice users see is
 * components/DailyChallengesDeprecatedAnnouncement.tsx.
 */
export const DAILY_CHALLENGES_ENABLED = false;
