// Staged rollout gate for Next Reward Progress V1
// (next-reward-progress-v1-spec.md §14 Slice 4 — staff/internal accounts,
// then a percentage cohort, then full rollout). Structurally identical to
// src/lib/games/gamesRollout.ts and src/lib/akiba/hubQuestRollout.ts (same
// env-var shape, allowlist-bypass-then-hash-bucket order) — a separate flag
// so Next Reward can go live independently of games/quests rollout.
type RolloutEnvironment = {
  [key: string]: string | undefined;
  HUB_NEXT_REWARD_ENABLED?: string;
  HUB_NEXT_REWARD_ROLLOUT_PERCENT?: string;
  HUB_NEXT_REWARD_ALLOWLIST?: string;
};

export type NextRewardRolloutConfig = {
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

export function getNextRewardRolloutConfig(
  env: RolloutEnvironment = process.env,
): NextRewardRolloutConfig {
  const requestedPercentage = Number(env.HUB_NEXT_REWARD_ROLLOUT_PERCENT ?? "0");
  const percentage = Number.isFinite(requestedPercentage)
    ? Math.min(100, Math.max(0, Math.trunc(requestedPercentage)))
    : 0;
  const allowlist = new Set(
    (env.HUB_NEXT_REWARD_ALLOWLIST ?? "")
      .split(",")
      .map((identifier) => identifier.trim().toLowerCase())
      .filter(Boolean),
  );

  return { enabled: isTruthy(env.HUB_NEXT_REWARD_ENABLED), percentage, allowlist };
}

/** identifier: prefer email; falls back to hubUserId for email-less lookups. */
export function isNextRewardEnabledFor(
  identifier: string,
  env: RolloutEnvironment = process.env,
): boolean {
  const config = getNextRewardRolloutConfig(env);
  if (!config.enabled) return false;

  const idLc = identifier.trim().toLowerCase();
  if (config.allowlist.has(idLc)) return true;
  if (config.percentage >= 100) return true;
  if (config.percentage <= 0) return false;
  return rolloutBucket(idLc) < config.percentage;
}

export function getNextRewardRolloutSummary(env: RolloutEnvironment = process.env) {
  const config = getNextRewardRolloutConfig(env);
  return { enabled: config.enabled, percentage: config.percentage, allowlistCount: config.allowlist.size };
}
