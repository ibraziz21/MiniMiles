// Staged rollout gate for walletless Pass skill games
// (walletless-pass-skill-games-spec.md §17 steps 7-8 — "Deploy Pass BFF and
// UI behind a rollout flag. Enable internal users, then a
// percentage/allowlist."). Structurally identical to
// lib/akiba/hubQuestRollout.ts (same env-var shape, allowlist-bypass-then-
// hash-bucket order) — a separate flag because games can go live
// independently of the Hub quest catalog rollout.
type RolloutEnvironment = {
  [key: string]: string | undefined;
  HUB_GAMES_ENABLED?: string;
  HUB_GAMES_ROLLOUT_PERCENT?: string;
  HUB_GAMES_ALLOWLIST?: string;
};

export type GamesRolloutConfig = {
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

export function getGamesRolloutConfig(env: RolloutEnvironment = process.env): GamesRolloutConfig {
  const requestedPercentage = Number(env.HUB_GAMES_ROLLOUT_PERCENT ?? "0");
  const percentage = Number.isFinite(requestedPercentage)
    ? Math.min(100, Math.max(0, Math.trunc(requestedPercentage)))
    : 0;
  const allowlist = new Set(
    (env.HUB_GAMES_ALLOWLIST ?? "")
      .split(",")
      .map((identifier) => identifier.trim().toLowerCase())
      .filter(Boolean),
  );

  return { enabled: isTruthy(env.HUB_GAMES_ENABLED), percentage, allowlist };
}

/** identifier: prefer email; falls back to hubUserId for email-less lookups. */
export function isGamesEnabledFor(identifier: string, env: RolloutEnvironment = process.env): boolean {
  const config = getGamesRolloutConfig(env);
  if (!config.enabled) return false;

  const idLc = identifier.trim().toLowerCase();
  if (config.allowlist.has(idLc)) return true;
  if (config.percentage >= 100) return true;
  if (config.percentage <= 0) return false;
  return rolloutBucket(idLc) < config.percentage;
}

export function getGamesRolloutSummary(env: RolloutEnvironment = process.env) {
  const config = getGamesRolloutConfig(env);
  return { enabled: config.enabled, percentage: config.percentage, allowlistCount: config.allowlist.size };
}
