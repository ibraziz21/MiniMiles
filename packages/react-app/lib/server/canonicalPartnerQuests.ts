import { supabase } from "@/lib/supabaseClient";
import { isoWeek } from "@/lib/games/week";
import {
  QUEST_AKIBA_PASS,
  QUEST_BROWSE_DEALS,
  QUEST_COMPLETE_PROFILE,
  QUEST_REDEEM_VOUCHER,
  QUEST_SPONSORED_LEADERBOARD,
  CANONICAL_API_PARTNER_QUEST_IDS,
  type MerchantDiscoveryQuestId,
} from "@/lib/merchantDiscoveryQuests";

export type CanonicalQuestKey =
  | "pass_activated"
  | "deal_viewed"
  | "sponsored_game_played"
  | "profile_country_set"
  | "voucher_redeemed";

export type CanonicalDeliveryState =
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export type CanonicalQuestDelivery = {
  completionId: string;
  deliveryId: string;
  questKey: CanonicalQuestKey;
  scopeKey: string;
  status: CanonicalDeliveryState;
  mode: "onchain_mint" | "offchain_ledger";
  awardedPoints: number;
  externalRef: string | null;
};

const QUEST_KEY_BY_REACT_ID: Record<MerchantDiscoveryQuestId, CanonicalQuestKey> = {
  [QUEST_AKIBA_PASS]: "pass_activated",
  [QUEST_BROWSE_DEALS]: "deal_viewed",
  [QUEST_SPONSORED_LEADERBOARD]: "sponsored_game_played",
  [QUEST_COMPLETE_PROFILE]: "profile_country_set",
  [QUEST_REDEEM_VOUCHER]: "voucher_redeemed",
};

export { CANONICAL_API_PARTNER_QUEST_IDS };

export function canonicalQuestKey(questId: MerchantDiscoveryQuestId): CanonicalQuestKey {
  return QUEST_KEY_BY_REACT_ID[questId];
}

export function canonicalQuestScope(questId: MerchantDiscoveryQuestId): string {
  return questId === QUEST_SPONSORED_LEADERBOARD ? isoWeek() : "lifetime";
}

function schemaUnavailable(error: any): boolean {
  return error?.code === "42P01" || error?.code === "PGRST202" || error?.code === "PGRST204";
}

export async function resolveCanonicalWallet(walletAddress: string): Promise<string> {
  if (typeof (supabase as any).rpc !== "function") {
    throw new Error("canonical partner quest RPC is unavailable");
  }
  const { data, error } = await supabase.rpc("resolve_partner_quest_canonical", {
    p_hub_user_id: null,
    p_email: null,
    p_wallet: walletAddress.toLowerCase(),
  });
  if (error) throw error;
  if (typeof data !== "string" || !data) {
    throw new Error("canonical participant resolution returned no id");
  }
  return data;
}

export async function getCanonicalMerchantQuestDeliveries(
  walletAddress: string,
): Promise<Map<MerchantDiscoveryQuestId, CanonicalQuestDelivery>> {
  if (typeof (supabase as any).rpc !== "function") return new Map();

  let canonicalId: string;
  try {
    canonicalId = await resolveCanonicalWallet(walletAddress);
  } catch (error) {
    if (schemaUnavailable(error)) return new Map();
    throw error;
  }

  const { data: completions, error: completionError } = await supabase
    .from("api_partner_quest_completions")
    .select("id, quest_key, scope_key")
    .eq("canonical_id", canonicalId);

  if (completionError) {
    if (schemaUnavailable(completionError)) return new Map();
    throw completionError;
  }

  const relevant = (completions ?? []).filter((row: any) =>
    row.scope_key === "lifetime" || row.scope_key === isoWeek(),
  );
  if (relevant.length === 0) return new Map();

  const { data: deliveries, error: deliveryError } = await supabase
    .from("api_partner_quest_reward_deliveries")
    .select("id, completion_id, status, mode, awarded_points, external_ref")
    .in("completion_id", relevant.map((row: any) => row.id));

  if (deliveryError) {
    if (schemaUnavailable(deliveryError)) return new Map();
    throw deliveryError;
  }

  const deliveryByCompletion = new Map(
    (deliveries ?? []).map((row: any) => [row.completion_id, row]),
  );
  const result = new Map<MerchantDiscoveryQuestId, CanonicalQuestDelivery>();

  for (const completion of relevant as any[]) {
    const reactQuestId = (Object.entries(QUEST_KEY_BY_REACT_ID).find(
      ([, key]) => key === completion.quest_key,
    )?.[0] ?? null) as MerchantDiscoveryQuestId | null;
    const delivery: any = deliveryByCompletion.get(completion.id);
    if (!reactQuestId || !delivery) continue;
    result.set(reactQuestId, {
      completionId: completion.id,
      deliveryId: delivery.id,
      questKey: completion.quest_key,
      scopeKey: completion.scope_key,
      status: delivery.status,
      mode: delivery.mode,
      awardedPoints: Number(delivery.awarded_points),
      externalRef: delivery.external_ref ?? null,
    });
  }

  return result;
}

export async function reserveCanonicalWalletQuest(input: {
  walletAddress: string;
  questId: MerchantDiscoveryQuestId;
  scopeKey: string;
  verificationSource: string;
  proofRef: string;
  awardedPoints: number;
}): Promise<CanonicalQuestDelivery & { created: boolean }> {
  const canonicalId = await resolveCanonicalWallet(input.walletAddress);
  const { data, error } = await supabase.rpc("reserve_api_partner_quest_claim", {
    p_canonical_id: canonicalId,
    p_quest_key: canonicalQuestKey(input.questId),
    p_scope_key: input.scopeKey,
    p_verification_source: input.verificationSource,
    p_proof_ref: input.proofRef,
    p_claimed_from: "react-app",
    p_delivery_mode: "onchain_mint",
    p_destination_wallet: input.walletAddress.toLowerCase(),
    p_awarded_points: input.awardedPoints,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as any;
  if (!row?.delivery_id) throw new Error("canonical claim reservation returned no delivery");
  return {
    completionId: row.completion_id,
    deliveryId: row.delivery_id,
    questKey: canonicalQuestKey(input.questId),
    scopeKey: input.scopeKey,
    status: row.delivery_status,
    mode: row.delivery_mode,
    awardedPoints: Number(row.awarded_points),
    externalRef: row.external_ref ?? null,
    created: Boolean(row.created),
  };
}

export async function retryCanonicalDelivery(deliveryId: string): Promise<void> {
  const { error } = await supabase
    .from("api_partner_quest_reward_deliveries")
    .update({ status: "pending", last_error: null, updated_at: new Date().toISOString() })
    .eq("id", deliveryId)
    .eq("status", "failed");
  if (error) throw error;
}

export async function failCanonicalDelivery(deliveryId: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc("fail_api_partner_quest_delivery", {
    p_delivery_id: deliveryId,
    p_error: reason,
  });
  if (error) throw error;
}
