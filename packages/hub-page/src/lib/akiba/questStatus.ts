import { createAdminClient } from "@/lib/supabase/admin";
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import { HUB_QUEST_CATALOG, type QuestCatalogEntry } from "@/lib/akiba/questCatalog";
import { isoWeek } from "@/lib/akiba/isoWeek";
import {
  getCanonicalHubDeliveries,
  resolveHubQuestCanonical,
  verifyHubQuestEvidence,
} from "@/lib/akiba/canonicalPartnerQuests";

export type HubQuestState =
  | "needs_action"
  | "wallet_required"
  | "eligible"
  | "verifying"
  | "reward_pending"
  | "completed"
  | "reward_failed"
  | "service_unavailable";

export type HubQuestStatus = {
  key: string;
  title: string;
  description: string;
  scopeKey: string;
  state: HubQuestState;
  deliveryId: string | null;
  miles: number;
  awardedPoints: number | null;
  deliveryMode: "onchain_mint" | "offchain_ledger" | null;
  frequency: QuestCatalogEntry["frequency"];
  actionHref: string;
  reason?: string;
};

type LegacyState = {
  completedQuestIds: Set<string>;
  jobs: Map<string, "pending" | "processing" | "completed" | "failed">;
};

function baseStatus(quest: QuestCatalogEntry): Omit<HubQuestStatus, "state"> {
  return {
    key: quest.key,
    title: quest.title,
    description: quest.description,
    scopeKey: quest.frequency === "weekly" ? isoWeek() : "lifetime",
    deliveryId: null,
    miles: quest.miles,
    awardedPoints: null,
    deliveryMode: null,
    frequency: quest.frequency,
    actionHref: quest.actionHref,
  };
}

function legacyJobKey(quest: QuestCatalogEntry, wallet: string, scopeKey: string): string {
  return quest.frequency === "weekly"
    ? `partner-weekly:${quest.reactPartnerQuestId}:${wallet}:${scopeKey}`
    : `partner:${quest.reactPartnerQuestId}:${wallet}`;
}

async function loadLegacyState(wallets: string[]): Promise<LegacyState> {
  if (wallets.length === 0) return { completedQuestIds: new Set(), jobs: new Map() };
  const admin = createAdminClient();
  const week = isoWeek();
  const oneTimeIds = HUB_QUEST_CATALOG.filter((q) => q.frequency === "once").map((q) => q.reactPartnerQuestId);
  const weeklyQuest = HUB_QUEST_CATALOG.find((q) => q.frequency === "weekly")!;
  const keys = wallets.flatMap((wallet) => HUB_QUEST_CATALOG.map((quest) => legacyJobKey(quest, wallet, week)));

  const [oneTime, weekly, jobs] = await Promise.all([
    admin.from("partner_engagements").select("partner_quest_id").in("user_address", wallets).in("partner_quest_id", oneTimeIds),
    admin.from("partner_quest_weekly_claims").select("partner_quest_id").in("user_address", wallets).eq("partner_quest_id", weeklyQuest.reactPartnerQuestId).eq("iso_week", week),
    admin.from("minipoint_mint_jobs").select("idempotency_key, status").in("idempotency_key", keys),
  ]);
  if (oneTime.error) throw oneTime.error;
  if (weekly.error) throw weekly.error;
  if (jobs.error) throw jobs.error;

  return {
    completedQuestIds: new Set([
      ...(oneTime.data ?? []).map((row: any) => row.partner_quest_id),
      ...(weekly.data ?? []).map((row: any) => row.partner_quest_id),
    ]),
    jobs: new Map((jobs.data ?? []).map((row: any) => [row.idempotency_key, row.status])),
  };
}

export async function getHubQuestStatuses(opts: {
  hubUserId: string;
  email: string | null;
}): Promise<HubQuestStatus[]> {
  const wallets = await getLinkedWalletAddresses(opts.hubUserId);

  let canonicalDeliveries;
  let legacy: LegacyState;
  let canonicalId: string;
  try {
    canonicalId = await resolveHubQuestCanonical(opts);
    [canonicalDeliveries, legacy] = await Promise.all([
      getCanonicalHubDeliveries(canonicalId),
      loadLegacyState(wallets),
    ]);
  } catch (error) {
    console.error("[questStatus] canonical completion lookup failed:", error);
    return HUB_QUEST_CATALOG.map((quest) => ({
      ...baseStatus(quest),
      state: "service_unavailable",
      reason: "canonical_completion_unavailable",
    }));
  }

  return Promise.all(HUB_QUEST_CATALOG.map(async (quest) => {
    const base = baseStatus(quest);
    const canonical = canonicalDeliveries.get(quest.key);
    if (canonical) {
      if (canonical.status === "completed") {
        return {
          ...base,
          state: "completed" as const,
          deliveryId: canonical.deliveryId,
          awardedPoints: canonical.awardedPoints,
          deliveryMode: canonical.mode,
        };
      }
      if (canonical.status === "pending" || canonical.status === "processing") {
        return {
          ...base,
          state: "reward_pending" as const,
          deliveryId: canonical.deliveryId,
          awardedPoints: canonical.awardedPoints,
          deliveryMode: canonical.mode,
        };
      }
      return {
        ...base,
        state: "reward_failed" as const,
        deliveryId: canonical.deliveryId,
        awardedPoints: canonical.awardedPoints,
        deliveryMode: canonical.mode,
        reason: "delivery_failed",
      };
    }

    const legacyStates = wallets.map((wallet) => legacy.jobs.get(legacyJobKey(quest, wallet, base.scopeKey))).filter(Boolean);
    if (legacyStates.includes("pending") || legacyStates.includes("processing")) {
      return { ...base, state: "reward_pending" as const, deliveryMode: "onchain_mint" as const };
    }
    if (legacyStates.includes("completed") || legacy.completedQuestIds.has(quest.reactPartnerQuestId)) {
      return { ...base, state: "completed" as const, awardedPoints: quest.miles, deliveryMode: "onchain_mint" as const };
    }
    if (legacyStates.includes("failed")) {
      return { ...base, state: "reward_failed" as const, deliveryMode: "onchain_mint" as const, reason: "legacy_mint_failed" };
    }

    if (quest.requiresWallet && wallets.length === 0) {
      return { ...base, state: "wallet_required" as const };
    }

    try {
      const evidence = await verifyHubQuestEvidence({ quest, hubUserId: opts.hubUserId, wallets, canonicalId });
      return evidence.eligible
        ? { ...base, state: "eligible" as const }
        : { ...base, state: "needs_action" as const, reason: evidence.reason };
    } catch (error) {
      console.error(`[questStatus] evidence lookup failed for ${quest.key}:`, error);
      return { ...base, state: "service_unavailable" as const, reason: "evidence_unavailable" };
    }
  }));
}
