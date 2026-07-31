// Resolves per-quest state for the account-first Hub catalog
// (merchant-shopping-quests-spec.md §6, GET /api/quests/status). Combines a
// local domain signal (has the member actually done the thing?) with
// Platform's quest_completions + reward lookup (has it been verified and
// rewarded?) — never a single "reward wallet"; every Platform lookup is
// scoped to every known identity (email + linked wallets) via buildIdentities.
import { createAdminClient } from "@/lib/supabase/admin";
import { buildIdentities } from "@/lib/akiba/identities";
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import { HUB_QUEST_CATALOG, type QuestCatalogEntry } from "@/lib/akiba/questCatalog";
import { isoWeek, weekRange } from "@/lib/akiba/isoWeek";

export type HubQuestState =
  | "needs_action"
  | "wallet_required"
  | "verifying"
  | "claimable"
  | "claiming"
  | "completed"
  | "reward_failed";

export type HubQuestStatus = {
  key: string;
  title: string;
  description: string;
  scopeKey: string;
  state: HubQuestState;
  rewardId: string | null;
  miles: number;
  frequency: QuestCatalogEntry["frequency"];
  actionHref: string;
  reason?: string;
};

type PlatformCompletion = {
  completionId: string;
  questId: string;
  identityType: string;
  identityValue: string;
  rewardAmount: number;
  completedAt: string;
  completionScope: string | null;
  periodKey: string | null;
  rewardId: string | null;
};

type PlatformReward = {
  id: string;
  status: "pending" | "active" | "claimed" | "cancelled" | "expired";
  [key: string]: unknown;
};

function platformConfigured(): boolean {
  return Boolean(process.env.AKIBA_API_URL && process.env.AKIBA_API_KEY);
}

async function platformGet<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
  if (!platformConfigured()) return { ok: false, reason: "platform_not_configured" };
  const AKIBA_API_URL = process.env.AKIBA_API_URL!;
  const AKIBA_API_KEY = process.env.AKIBA_API_KEY!;

  try {
    const res = await fetch(`${AKIBA_API_URL}${path}`, {
      headers: { Authorization: `Bearer ${AKIBA_API_KEY}` },
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: `platform_${res.status}` };
    const body = await res.json();
    return { ok: true, data: (body.data ?? body) as T };
  } catch (err) {
    console.error("[questStatus] platform request failed:", err);
    return { ok: false, reason: "platform_unavailable" };
  }
}

async function fetchCompletionsForIdentity(
  questId: string,
  identity: { type: string; value: string },
  range?: { from: string; to: string },
): Promise<PlatformCompletion[]> {
  const params = new URLSearchParams({
    identityType: identity.type,
    identityValue: identity.value,
  });
  if (range) {
    params.set("from", range.from);
    params.set("to", range.to);
  }
  const result = await platformGet<PlatformCompletion[]>(
    `/api/v1/quests/${questId}/completions?${params.toString()}`,
  );
  return result.ok ? result.data : [];
}

async function fetchReward(rewardId: string): Promise<PlatformReward | null> {
  const result = await platformGet<PlatformReward>(`/api/v1/rewards/${rewardId}`);
  return result.ok ? result.data : null;
}

async function resolveLocalSignal(
  quest: QuestCatalogEntry,
  ctx: { hubUserId: string; wallets: string[] },
): Promise<boolean> {
  const admin = createAdminClient();
  const { hubUserId, wallets } = ctx;

  switch (quest.key) {
    case "pass_activated": {
      const { data } = await admin
        .from("hub_user_passes")
        .select("id")
        .eq("user_id", hubUserId)
        .maybeSingle();
      return Boolean(data);
    }
    case "deal_viewed": {
      const { data } = await admin
        .from("hub_quest_action_proofs")
        .select("id")
        .eq("hub_user_id", hubUserId)
        .eq("quest_key", "deal_viewed")
        .limit(1)
        .maybeSingle();
      return Boolean(data);
    }
    case "profile_country_set": {
      const { data } = await admin
        .from("hub_user_profiles")
        .select("country")
        .eq("user_id", hubUserId)
        .maybeSingle();
      return Boolean(data?.country && data.country.trim().length > 0);
    }
    case "voucher_redeemed": {
      const filter =
        wallets.length > 0
          ? `hub_user_id.eq.${hubUserId},user_address.in.(${wallets.join(",")})`
          : `hub_user_id.eq.${hubUserId}`;
      const { data } = await admin
        .from("issued_vouchers")
        .select("id")
        .eq("status", "redeemed")
        .or(filter)
        .limit(1)
        .maybeSingle();
      return Boolean(data);
    }
    case "sponsored_game_played":
      // No Hub-local domain table for this — Platform's completions lookup
      // (scoped to wallet identity below) is the sole source of truth.
      return wallets.length > 0;
    default:
      return false;
  }
}

async function resolveOneQuest(
  quest: QuestCatalogEntry,
  ctx: { hubUserId: string; identities: { type: string; value: string }[]; wallets: string[] },
): Promise<HubQuestStatus> {
  const scopeKey = quest.frequency === "weekly" ? isoWeek() : "lifetime";
  const base = {
    key: quest.key,
    title: quest.title,
    description: quest.description,
    scopeKey,
    miles: quest.miles,
    frequency: quest.frequency,
    actionHref: quest.actionHref,
    rewardId: null as string | null,
  };

  if (quest.requiresWallet && ctx.wallets.length === 0) {
    return { ...base, state: "wallet_required" };
  }

  const localDone = await resolveLocalSignal(quest, { hubUserId: ctx.hubUserId, wallets: ctx.wallets });
  if (!localDone) {
    return { ...base, state: "needs_action" };
  }

  if (!quest.platformQuestId) {
    return { ...base, state: "verifying", reason: "quest_not_configured" };
  }

  const range = quest.frequency === "weekly" ? weekRange(scopeKey) : undefined;

  let completions: PlatformCompletion[] = [];
  let sawPlatformFailure = false;
  for (const identity of ctx.identities) {
    const result = await platformGet<PlatformCompletion[]>(
      `/api/v1/quests/${quest.platformQuestId}/completions?${new URLSearchParams({
        identityType: identity.type,
        identityValue: identity.value,
        ...(range ? { from: range.from, to: range.to } : {}),
      }).toString()}`,
    );
    if (!result.ok) {
      sawPlatformFailure = true;
      continue;
    }
    completions = completions.concat(result.data);
  }

  const withReward = completions.find((c) => c.rewardId);
  if (!withReward?.rewardId) {
    if (sawPlatformFailure && completions.length === 0) {
      return { ...base, state: "verifying", reason: "platform_unavailable" };
    }
    return { ...base, state: "verifying" };
  }

  const reward = await fetchReward(withReward.rewardId);
  if (!reward) {
    return { ...base, state: "verifying", reason: "reward_lookup_failed" };
  }
  if (reward.status === "claimed") {
    return { ...base, state: "completed", rewardId: reward.id };
  }
  if (reward.status === "active") {
    return { ...base, state: "claimable", rewardId: reward.id };
  }
  if (reward.status === "pending") {
    return { ...base, state: "verifying", rewardId: reward.id };
  }
  return { ...base, state: "reward_failed", rewardId: reward.id, reason: reward.status };
}

export async function getHubQuestStatuses(opts: {
  hubUserId: string;
  email: string | null;
}): Promise<HubQuestStatus[]> {
  const identities = await buildIdentities({ userId: opts.hubUserId, email: opts.email });
  const wallets = await getLinkedWalletAddresses(opts.hubUserId);

  return Promise.all(
    HUB_QUEST_CATALOG.map((quest) =>
      resolveOneQuest(quest, { hubUserId: opts.hubUserId, identities, wallets }),
    ),
  );
}
