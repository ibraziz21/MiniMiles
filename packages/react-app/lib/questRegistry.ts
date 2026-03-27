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
} as const;
