// lib/streakRegistry.ts
//
// Fixed server-side registry for the wallet-balance streak tiers
// (docs/all-quests-self-claim-spec.md §5.5: "Quest IDs and balance tiers
// must map through a fixed server registry; unknown combinations return
// 400."). Previously app/api/streaks/balances/route.ts derived minUsd/points
// from a client-supplied `tier` string with no link back to the questId —
// a client could send a real $10-tier questId alongside tier:"100" and be
// paid the $100 reward for only a $10 balance. These IDs are the same
// literals already hardcoded in app/api/streaks/status/route.ts and
// helpers/claimBalanceStreak.ts — kept as-is rather than moved to
// questRegistry.ts's env-var convention, since that's how every other
// caller already references them.

export type BalanceStreakTier = "10" | "30" | "100";

export const BALANCE_STREAK_QUEST_IDS: Record<BalanceStreakTier, string> = {
  "10": "feb6e5ef-7d9c-4ca6-a042-e2b692a6b00f",
  "30": "a1ac5914-20d4-4436-bf02-29563938fe9d",
  "100": "b5c7e1d2-6f8a-4b0c-9d2e-3a1f7c5b8e4d",
};

export type BalanceStreakConfig = {
  questId: string;
  tier: BalanceStreakTier;
  minUsd: number;
  points: number;
};

const BALANCE_STREAK_CONFIG_BY_QUEST_ID: Record<string, BalanceStreakConfig> = {
  [BALANCE_STREAK_QUEST_IDS["10"]]: { questId: BALANCE_STREAK_QUEST_IDS["10"], tier: "10", minUsd: 10, points: 40 },
  [BALANCE_STREAK_QUEST_IDS["30"]]: { questId: BALANCE_STREAK_QUEST_IDS["30"], tier: "30", minUsd: 30, points: 50 },
  [BALANCE_STREAK_QUEST_IDS["100"]]: { questId: BALANCE_STREAK_QUEST_IDS["100"], tier: "100", minUsd: 100, points: 70 },
};

/** Returns null for any questId not in the fixed registry — callers must reject unknown combinations. */
export function getBalanceStreakConfigByQuestId(questId: string): BalanceStreakConfig | null {
  return BALANCE_STREAK_CONFIG_BY_QUEST_ID[questId] ?? null;
}

// Weekly top-up streak — same literal-ID convention (currently unused in the
// UI: its daily-challenge.tsx card is commented out), preserved for the
// existing /api/streaks/topup route and app/api/streaks/status/route.ts.
export const TOPUP_STREAK_QUEST_ID = "96009afb-0762-4399-adb3-ced421d73072";
export const TOPUP_STREAK_POINTS = 25;
