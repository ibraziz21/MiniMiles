import { MERCHANT_DISCOVERY_QUEST_IDS } from "@/lib/merchantDiscoveryQuests";

type RolloutEnvironment = {
  [key: string]: string | undefined;
  MERCHANT_QUESTS_ENABLED?: string;
  MERCHANT_QUESTS_ROLLOUT_PERCENT?: string;
  MERCHANT_QUESTS_ALLOWLIST?: string;
};

export type MerchantQuestRolloutConfig = {
  enabled: boolean;
  percentage: number;
  allowlist: Set<string>;
};

function isTruthy(value?: string): boolean {
  return ["1", "true", "yes", "on"].includes(
    value?.trim().toLowerCase() ?? "",
  );
}

function rolloutBucket(userAddress: string): number {
  let hash = 2166136261;
  for (const character of userAddress.toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 100;
}

export function getMerchantQuestRolloutConfig(
  env: RolloutEnvironment = process.env,
): MerchantQuestRolloutConfig {
  const requestedPercentage = Number(
    env.MERCHANT_QUESTS_ROLLOUT_PERCENT ?? "0",
  );
  const percentage = Number.isFinite(requestedPercentage)
    ? Math.min(100, Math.max(0, Math.trunc(requestedPercentage)))
    : 0;
  const allowlist = new Set(
    (env.MERCHANT_QUESTS_ALLOWLIST ?? "")
      .split(",")
      .map((address) => address.trim().toLowerCase())
      .filter(Boolean),
  );

  return {
    enabled: isTruthy(env.MERCHANT_QUESTS_ENABLED),
    percentage,
    allowlist,
  };
}

export function isMerchantQuestEnabledForAddress(
  userAddress: string,
  env: RolloutEnvironment = process.env,
): boolean {
  const config = getMerchantQuestRolloutConfig(env);
  if (!config.enabled) return false;

  const userLc = userAddress.trim().toLowerCase();
  if (config.allowlist.has(userLc)) return true;
  if (config.percentage >= 100) return true;
  if (config.percentage <= 0) return false;
  return rolloutBucket(userLc) < config.percentage;
}

export function shouldGateMerchantQuest(
  questId: string,
  userAddress: string,
  env: RolloutEnvironment = process.env,
): boolean {
  return (
    (MERCHANT_DISCOVERY_QUEST_IDS as readonly string[]).includes(questId) &&
    !isMerchantQuestEnabledForAddress(userAddress, env)
  );
}

export function getMerchantQuestRolloutSummary(
  env: RolloutEnvironment = process.env,
) {
  const config = getMerchantQuestRolloutConfig(env);
  return {
    enabled: config.enabled,
    percentage: config.percentage,
    allowlistCount: config.allowlist.size,
  };
}
