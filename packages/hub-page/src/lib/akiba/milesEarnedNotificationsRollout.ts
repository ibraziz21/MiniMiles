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

/**
 * The member a decision is about. The capability check (which tells the app
 * the feature is on) and the send-time check must agree on every member, so
 * both pass the same thing: the Hub user id always, the email when known.
 *
 * They previously disagreed — capabilities hashed the email, the producer
 * hashed the user id — so under a partial rollout a member could be told
 * the feature was on and never be sent anything, and an email in the
 * allowlist never matched at send time.
 */
export type RolloutMember = { hubUserId: string; email?: string | null };

function memberEnabled(config: MilesEarnedRolloutConfig, member: RolloutMember): boolean {
  const id = member.hubUserId.trim().toLowerCase();
  const email = member.email?.trim().toLowerCase();
  // The allowlist may name members either way; operators reach for emails.
  if (config.allowlist.has(id) || (email && config.allowlist.has(email))) return true;
  if (config.percentage >= 100) return true;
  if (config.percentage <= 0) return false;
  // The bucket is always the user id: it is the one identifier both callers
  // have, and it doesn't move when a member changes their email.
  return rolloutBucket(id) < config.percentage;
}

/** Whether the allowlist is in use, i.e. whether an email could change the answer. */
export function milesEarnedAllowlistInUse(env: RolloutEnvironment = process.env): boolean {
  return getMilesEarnedRolloutConfig(env).allowlist.size > 0;
}

export function isMilesEarnedNotificationEnabledFor(
  member: RolloutMember,
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

  return memberEnabled(config, member);
}

/**
 * Member-level eligibility only — enabled + allowlist + percentage bucket,
 * without the merchant pilot-cohort gate `isMilesEarnedNotificationEnabledFor`
 * applies at send-time. For callers (e.g. the mobile capability service)
 * that need to answer "is this notification class live for this member at
 * all" without a specific merchant in hand.
 */
export function isMilesEarnedNotificationsEnabledForMember(
  member: RolloutMember,
  env: RolloutEnvironment = process.env,
): boolean {
  const config = getMilesEarnedRolloutConfig(env);
  if (!config.enabled) return false;
  return memberEnabled(config, member);
}
