// Single capability service shared by GET /api/v1/config and
// GET /api/v1/me/bootstrap (hub-mobile-app-migration-plan.md — "centralize
// evaluation behind an actor-driven capability service used by web and API
// callers"). Reuses every existing kill switch and rollout evaluator
// unchanged — same identifier convention their current web call sites
// already use — so native and web can never resolve a flag differently for
// the same member. Games' rollout is never referenced here: native has no
// Games surface.
import type { RequestActor } from "@/lib/auth/requestActor";
import {
  walletLinkingFlag,
  offlinePassFlag,
  hubQuestClaimsFlag,
  akibaFundedVouchersHubFlag,
} from "@/lib/featureFlags.server";
import { isHubQuestsEnabledFor } from "@/lib/akiba/hubQuestRollout";
import { isDiscoveryContributionsEnabledFor } from "@/lib/akiba/discoveryContributionsRollout";
import { isMilesEarnedNotificationsEnabledForMember } from "@/lib/akiba/milesEarnedNotificationsRollout";

export type NativeFeatureFlags = {
  walletLinking: boolean;
  offlinePass: boolean;
  hubQuestClaims: boolean;
  akibaFundedVouchers: boolean;
  quests: boolean;
  discoveryContributions: boolean;
  milesEarnedNotifications: boolean;
};

/**
 * Resolves only booleans — never rollout percentages, allowlists, or
 * operator-facing disable reasons — matching the plan's "return only
 * resolved booleans to clients" rule.
 */
export function resolveNativeFeatureFlags(actor: RequestActor | null): NativeFeatureFlags {
  const identifier = actor ? actor.email ?? actor.userId : null;

  return {
    walletLinking: walletLinkingFlag().enabled,
    offlinePass: offlinePassFlag().enabled,
    hubQuestClaims: hubQuestClaimsFlag().enabled,
    akibaFundedVouchers: akibaFundedVouchersHubFlag().enabled,
    quests: identifier ? isHubQuestsEnabledFor(identifier) : false,
    discoveryContributions: actor ? isDiscoveryContributionsEnabledFor(actor.userId) : false,
    milesEarnedNotifications: identifier ? isMilesEarnedNotificationsEnabledForMember(identifier) : false,
  };
}
