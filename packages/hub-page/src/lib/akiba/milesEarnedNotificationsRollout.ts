// Staged rollout gate for earned-Miles notifications
// (akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §10 —
// "Use a server-side enqueue flag, for example: HUB_MILES_EARNED_
// NOTIFICATIONS_ENABLED", staged internal accounts -> pilot merchants ->
// percentage expansion -> flag removed, emergency flag retained).
// Structurally identical to lib/games/gamesRollout.ts.
type RolloutEnvironment = {
  [key: string]: string | undefined;
  HUB_MILES_EARNED_NOTIFICATIONS_ENABLED?: string;
  HUB_MILES_EARNED_NOTIFICATIONS_ROLLOUT_PERCENT?: string;
  HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST?: string;
  HUB_MILES_EARNED_NOTIFICATIONS_MERCHANT_ALLOWLIST?: string;
};

export type MilesEarnedRolloutConfig = {
  enabled: boolean;
  percentage: number;
  allowlist: Set<string>;
  merchantAllowlist: Set<string>;
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

export function getMilesEarnedRolloutConfig(env: RolloutEnvironment = process.env): MilesEarnedRolloutConfig {
  const requestedPercentage = Number(env.HUB_MILES_EARNED_NOTIFICATIONS_ROLLOUT_PERCENT ?? "0");
  const percentage = Number.isFinite(requestedPercentage)
    ? Math.min(100, Math.max(0, Math.trunc(requestedPercentage)))
    : 0;
  const allowlist = new Set(
    (env.HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST ?? "")
      .split(",")
      .map((identifier) => identifier.trim().toLowerCase())
      .filter(Boolean),
  );
  const merchantAllowlist = new Set(
    (env.HUB_MILES_EARNED_NOTIFICATIONS_MERCHANT_ALLOWLIST ?? "")
      .split(",")
      .map((id) => id.trim().toLowerCase())
      .filter(Boolean),
  );

  return { enabled: isTruthy(env.HUB_MILES_EARNED_NOTIFICATIONS_ENABLED), percentage, allowlist, merchantAllowlist };
}

/** identifier: prefer email; falls back to hubUserId for email-less lookups. */
export function isMilesEarnedNotificationEnabledFor(
  identifier: string,
  merchantId: string,
  env: RolloutEnvironment = process.env,
): boolean {
  const config = getMilesEarnedRolloutConfig(env);
  if (!config.enabled) return false;

  // Pilot-merchant cohort (§10 step 4) — while set, only these merchants'
  // credits produce a notification, regardless of the member percentage.
  if (config.merchantAllowlist.size > 0 && !config.merchantAllowlist.has(merchantId.trim().toLowerCase())) {
    return false;
  }

  const idLc = identifier.trim().toLowerCase();
  if (config.allowlist.has(idLc)) return true;
  if (config.percentage >= 100) return true;
  if (config.percentage <= 0) return false;
  return rolloutBucket(idLc) < config.percentage;
}
