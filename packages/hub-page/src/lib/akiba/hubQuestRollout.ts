// Staged rollout gate for the account-first Hub quest catalog
// (merchant-shopping-quests-spec.md §8 Slice 4 — "internal accounts, then a
// percentage cohort, then all members"). Structurally identical to
// react-app's lib/server/merchantQuestRollout.ts (same env-var shape,
// allowlist-bypass-then-hash-bucket order), adapted to key on the Hub
// member's identifier (email, falling back to hubUserId) instead of a
// wallet address — no shared package exists between the two apps.
type RolloutEnvironment = {
  [key: string]: string | undefined;
  HUB_QUESTS_ENABLED?: string;
  HUB_QUESTS_ROLLOUT_PERCENT?: string;
  HUB_QUESTS_ALLOWLIST?: string;
};

export type HubQuestRolloutConfig = {
  enabled: boolean;
  percentage: number;
  allowlist: Set<string>;
};

function isTruthy(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

function rolloutBucket(identifier: string): number {
  let hash = 2166136261;
  for (const character of identifier.toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function getHubQuestRolloutConfig(
  env: RolloutEnvironment = process.env,
): HubQuestRolloutConfig {
  const requestedPercentage = Number(env.HUB_QUESTS_ROLLOUT_PERCENT ?? "0");
  const percentage = Number.isFinite(requestedPercentage)
    ? Math.min(100, Math.max(0, Math.trunc(requestedPercentage)))
    : 0;
  const allowlist = new Set(
    (env.HUB_QUESTS_ALLOWLIST ?? "")
      .split(",")
      .map((identifier) => identifier.trim().toLowerCase())
      .filter(Boolean),
  );

  return { enabled: isTruthy(env.HUB_QUESTS_ENABLED), percentage, allowlist };
}

/** identifier: prefer email; falls back to hubUserId for email-less lookups. */
export function isHubQuestsEnabledFor(
  identifier: string,
  env: RolloutEnvironment = process.env,
): boolean {
  const config = getHubQuestRolloutConfig(env);
  if (!config.enabled) return false;

  const idLc = identifier.trim().toLowerCase();
  if (config.allowlist.has(idLc)) return true;
  if (config.percentage >= 100) return true;
  if (config.percentage <= 0) return false;
  return rolloutBucket(idLc) < config.percentage;
}

export function getHubQuestRolloutSummary(env: RolloutEnvironment = process.env) {
  const config = getHubQuestRolloutConfig(env);
  return { enabled: config.enabled, percentage: config.percentage, allowlistCount: config.allowlist.size };
}
