// lib/server/adapters/dailyEngagementAdapterFactory.ts
//
// Every Phase-2 family (transfer/receive/count/Kiln) shares the exact same
// shape: a UTC-daily scope, the generic hashed claim nonce, and the
// daily_engagement finalizer — they only differ in their eligibility check
// (docs/all-quests-self-claim-spec.md §8.1). This factory extracts that
// shared shape so each family's adapter file is just its own eligibility
// rule, matching the legacy route it replaces exactly.

import { computeGenericClaimNonce, deadlineForScope, getUtcDateKey } from "@/lib/dailyQuestClaimer";
import { legacyDailyIdempotencyKey } from "@/lib/server/legacyMintJobGuard";
import type {
  QuestClaimAdapter,
  QuestEligibilityCheck,
  QuestIdentity,
  SelfClaimSession,
} from "@/lib/server/questClaimAdapters";
import type { QuestConfig } from "@/lib/questRegistry";

export type DailyEligibilityCheck =
  | { ok: true }
  | { ok: false; status: number; code?: string; message: string };

export function makeDailyEngagementAdapter(opts: {
  family: string;
  loadQuest: () => QuestConfig;
  checkEligibility: (session: SelfClaimSession) => Promise<DailyEligibilityCheck>;
}): QuestClaimAdapter {
  return {
    family: opts.family,

    async resolveIdentity(): Promise<QuestIdentity> {
      const quest = opts.loadQuest();
      const scopeKey = getUtcDateKey();
      const claimNonce = computeGenericClaimNonce(quest.questId, scopeKey);
      const deadline = deadlineForScope("daily", scopeKey);
      return { questId: quest.questId, scopeKey, claimNonce, deadline };
    },

    async verifyEligibility(session, identity): Promise<QuestEligibilityCheck> {
      const eligibility = await opts.checkEligibility(session);
      if (!eligibility.ok) return eligibility;

      const quest = opts.loadQuest();
      return {
        ok: true,
        result: {
          basePoints: quest.points,
          finalizerKind: "daily_engagement",
          finalizerPayload: { questId: quest.questId, claimDate: identity.scopeKey },
        },
      };
    },

    legacyIdempotencyKey(identity, userAddress) {
      return legacyDailyIdempotencyKey(identity.questId, userAddress, identity.scopeKey);
    },
  };
}
