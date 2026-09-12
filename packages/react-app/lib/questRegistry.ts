/**
 * questRegistry.ts
 *
 * Single source of truth for all quest IDs and their reward config.
 * Routes NEVER accept questId from the caller — they look it up here.
 * Quest IDs are set via environment variables so they can be updated
 * without a code deploy.
 */

export type QuestConfig = {
  questId: string;
  points: number;
  reason: string;
};

function required(envKey: string): string {
  const v = process.env[envKey];
  if (!v) throw new Error(`[questRegistry] Missing env var: ${envKey}`);
  return v;
}

/**
 * Returns the config for a quest by its route key.
 * Throws if the env var for that quest is not set.
 */
export function getQuest(key: keyof typeof QUEST_KEYS): QuestConfig {
  return QUEST_KEYS[key]();
}

const QUEST_KEYS = {
  daily_checkin: (): QuestConfig => ({
    questId: required("QUEST_ID_DAILY_CHECKIN"),
    points: 10,
    reason: `daily-engagement:${required("QUEST_ID_DAILY_CHECKIN")}`,
  }),
  daily_transfer: (): QuestConfig => ({
    questId: required("QUEST_ID_DAILY_TRANSFER"),
    points: 30,
    reason: `daily-transfer:${required("QUEST_ID_DAILY_TRANSFER")}`,
  }),
  daily_receive: (): QuestConfig => ({
    questId: required("QUEST_ID_DAILY_RECEIVE"),
    points: 30,
    reason: `daily-receive:${required("QUEST_ID_DAILY_RECEIVE")}`,
  }),
  daily_5tx: (): QuestConfig => ({
    questId: required("QUEST_ID_DAILY_5TX"),
    points: 50,
    reason: `daily-5tx:${required("QUEST_ID_DAILY_5TX")}`,
  }),
  daily_10tx: (): QuestConfig => ({
    questId: required("QUEST_ID_DAILY_10TX"),
    points: 60,
    reason: `daily-10tx:${required("QUEST_ID_DAILY_10TX")}`,
  }),
  daily_kiln_hold: (): QuestConfig => ({
    questId: required("QUEST_ID_DAILY_KILN_HOLD"),
    points: Number(process.env.KILN_DAILY_POINTS ?? "40"),
    reason: "kiln-daily-hold",
  }),
  // docs/all-quests-self-claim-spec.md §8.1: previously had no registry entry
  // — app/api/quests/daily_20_tx/route.ts fell back to the literal string
  // "daily_20tx" as its own questId and a hard-coded 50-point reward.
  daily_20tx: (): QuestConfig => ({
    questId: required("QUEST_ID_DAILY_20TX"),
    points: Number(process.env.DAILY_20TX_POINTS ?? "50"),
    reason: `daily-20tx:${required("QUEST_ID_DAILY_20TX")}`,
  }),
  // docs/all-quests-self-claim-spec.md §5.5: app/api/streaks/games/route.ts
  // previously took questId directly from the client with no registry at
  // all. Unlike the balance-streak/topup quest IDs (which are already
  // hardcoded literals used consistently elsewhere in the app), no games-
  // streak quest ID is hardcoded anywhere today — this route also has no
  // active UI entry point yet (hooks/useStreakQuests.ts's
  // useGamesStreakQuest is unused) — so it follows the env-var convention
  // instead, matching every other not-yet-hardcoded quest in this registry.
  games_streak: (): QuestConfig => ({
    questId: required("QUEST_ID_GAMES_STREAK"),
    points: Number(process.env.GAMES_STREAK_POINTS ?? "15"),
    reason: "games-streak",
  }),
} as const;
