// Rollout gate for the verified-discovery visit-card contribution flow
// (verified-discovery-acquisition-v1-spec.md §8.2). Structurally identical
// to lib/akiba/milesEarnedNotificationsRollout.ts — same shape, same
// rolloutBucket() hash. No merchant-cohort dimension: with a single
// participating merchant there's nothing for a per-merchant allowlist to
// gate, so this is just a global kill switch, a rollout percentage and a
// user allowlist.
type RolloutEnvironment = {
  [key: string]: string | undefined;
  HUB_DISCOVERY_CONTRIBUTIONS_ENABLED?: string;
  HUB_DISCOVERY_CONTRIBUTIONS_ROLLOUT_PERCENT?: string;
  HUB_DISCOVERY_CONTRIBUTIONS_ALLOWLIST?: string;
};

export type DiscoveryContributionsRolloutConfig = {
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

export function getDiscoveryContributionsRolloutConfig(
  env: RolloutEnvironment = process.env,
): DiscoveryContributionsRolloutConfig {
  const requestedPercentage = Number(env.HUB_DISCOVERY_CONTRIBUTIONS_ROLLOUT_PERCENT ?? "0");
  const percentage = Number.isFinite(requestedPercentage)
    ? Math.min(100, Math.max(0, Math.trunc(requestedPercentage)))
    : 0;
  const allowlist = new Set(
    (env.HUB_DISCOVERY_CONTRIBUTIONS_ALLOWLIST ?? "")
      .split(",")
      .map((identifier) => identifier.trim().toLowerCase())
      .filter(Boolean),
  );

  return { enabled: isTruthy(env.HUB_DISCOVERY_CONTRIBUTIONS_ENABLED), percentage, allowlist };
}

/** identifier: the Hub user id (auth.users.id) of the potential contributor. */
export function isDiscoveryContributionsEnabledFor(
  identifier: string,
  env: RolloutEnvironment = process.env,
): boolean {
  const config = getDiscoveryContributionsRolloutConfig(env);
  if (!config.enabled) return false;

  const idLc = identifier.trim().toLowerCase();
  if (config.allowlist.has(idLc)) return true;
  if (config.percentage >= 100) return true;
  if (config.percentage <= 0) return false;
  return rolloutBucket(idLc) < config.percentage;
}
