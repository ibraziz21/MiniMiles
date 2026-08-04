import { createAdminClient } from "@/lib/supabase/admin";
import { getLinkedWalletAddresses } from "@/lib/akiba/myVouchers";
import { HUB_QUEST_CATALOG, getQuestCatalogEntry, type QuestCatalogEntry } from "@/lib/akiba/questCatalog";
import { isoWeek, weekRange } from "@/lib/akiba/isoWeek";
import { readChainBalance } from "@/lib/akiba/balance";
import { createPublicClient, erc20Abi, http } from "viem";
import { celo } from "viem/chains";

export type CanonicalRewardDelivery = {
  completionId: string;
  deliveryId: string;
  questKey: string;
  scopeKey: string;
  status: "pending" | "processing" | "completed" | "failed";
  mode: "onchain_mint" | "offchain_ledger";
  awardedPoints: number;
  externalRef: string | null;
};

export type HubQuestEvidence = {
  eligible: boolean;
  proofRef?: string;
  reason?: string;
};

export async function resolveHubQuestCanonical(input: {
  hubUserId: string;
  email: string | null;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("resolve_partner_quest_canonical", {
    p_hub_user_id: input.hubUserId,
    p_email: input.email,
    p_wallet: null,
  });
  if (error) throw error;
  if (typeof data !== "string" || !data) {
    throw new Error("canonical participant resolution returned no id");
  }
  return data;
}

export async function getHubCanonicalLedgerBalance(input: {
  hubUserId: string;
  email: string | null;
}): Promise<number> {
  const canonicalId = await resolveHubQuestCanonical(input);
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("miles_ledger")
    .select("amount, direction")
    .eq("canonical_id", canonicalId)
    .eq("on_chain", false);
  if (error) throw error;
  return (data ?? []).reduce(
    (sum: number, row: any) => sum + (row.direction === "credit" ? Number(row.amount) : -Number(row.amount)),
    0,
  );
}

export async function getHubCanonicalBalance(input: {
  hubUserId: string;
  email: string | null;
}): Promise<number> {
  const wallet = await primaryVerifiedWallet(input.hubUserId);
  const [ledger, onchain] = await Promise.all([
    getHubCanonicalLedgerBalance(input),
    wallet ? readChainBalance(wallet) : Promise.resolve(0),
  ]);
  return ledger + onchain;
}

export async function linkVerifiedWalletToHubCanonical(input: {
  hubUserId: string;
  email: string | null;
  wallet: string;
}): Promise<string> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("link_partner_quest_wallet_identity", {
    p_hub_user_id: input.hubUserId,
    p_email: input.email,
    p_wallet: input.wallet.toLowerCase(),
  });
  if (error) throw error;
  if (typeof data !== "string" || !data) throw new Error("canonical wallet link failed");
  return data;
}

export async function getCanonicalHubDeliveries(
  canonicalId: string,
): Promise<Map<string, CanonicalRewardDelivery>> {
  const admin = createAdminClient();
  const { data: completions, error: completionError } = await admin
    .from("api_partner_quest_completions")
    .select("id, quest_key, scope_key")
    .eq("canonical_id", canonicalId);
  if (completionError) throw completionError;

  const relevant = (completions ?? []).filter(
    (row: any) => row.scope_key === "lifetime" || row.scope_key === isoWeek(),
  );
  if (relevant.length === 0) return new Map();

  const { data: deliveries, error: deliveryError } = await admin
    .from("api_partner_quest_reward_deliveries")
    .select("id, completion_id, status, mode, awarded_points, external_ref")
    .in("completion_id", relevant.map((row: any) => row.id));
  if (deliveryError) throw deliveryError;

  const byCompletion = new Map((deliveries ?? []).map((row: any) => [row.completion_id, row]));
  const result = new Map<string, CanonicalRewardDelivery>();
  for (const completion of relevant as any[]) {
    const delivery: any = byCompletion.get(completion.id);
    if (!delivery) continue;
    result.set(completion.quest_key, {
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

export async function verifyHubQuestEvidence(input: {
  quest: QuestCatalogEntry;
  hubUserId: string;
  wallets: string[];
}): Promise<HubQuestEvidence> {
  const { quest, hubUserId, wallets } = input;
  const admin = createAdminClient();

  if (quest.key === "pass_activated") {
    const { data, error } = await admin.from("hub_user_passes").select("id").eq("user_id", hubUserId).maybeSingle();
    if (error) throw error;
    return data ? { eligible: true, proofRef: `hub_user_pass:${data.id}` } : { eligible: false, reason: "pass-not-activated" };
  }

  if (quest.key === "deal_viewed") {
    const { data, error } = await admin
      .from("hub_quest_action_proofs")
      .select("id, action_ref")
      .eq("hub_user_id", hubUserId)
      .eq("quest_key", quest.key)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data ? { eligible: true, proofRef: `hub_deal_proof:${data.id}:${data.action_ref}` } : { eligible: false, reason: "deal-not-viewed" };
  }

  if (quest.key === "profile_country_set") {
    const { data, error } = await admin.from("hub_user_profiles").select("user_id, country").eq("user_id", hubUserId).maybeSingle();
    if (error) throw error;
    return data?.country?.trim()
      ? { eligible: true, proofRef: `hub_profile:${data.user_id}` }
      : { eligible: false, reason: "country-not-set" };
  }

  if (quest.key === "voucher_redeemed") {
    let query = admin.from("issued_vouchers").select("id").eq("status", "redeemed");
    query = wallets.length > 0
      ? query.or(`hub_user_id.eq.${hubUserId},user_address.in.(${wallets.join(",")})`)
      : query.eq("hub_user_id", hubUserId);
    const { data, error } = await query.limit(1).maybeSingle();
    if (error) throw error;
    return data ? { eligible: true, proofRef: `issued_voucher:${data.id}` } : { eligible: false, reason: "no-redeemed-voucher" };
  }

  if (quest.key === "sponsored_game_played") {
    if (wallets.length === 0) return { eligible: false, reason: "wallet-required" };
    const monday = weekRange(isoWeek()).from.slice(0, 10);
    const { data: campaign, error: campaignError } = await admin
      .from("game_weekly_campaigns")
      .select("game_types")
      .eq("active", true)
      .lte("week_from", monday)
      .gt("week_to", monday)
      .maybeSingle();
    if (campaignError) throw campaignError;
    const gameTypes = Array.isArray(campaign?.game_types) ? campaign.game_types : [];
    if (gameTypes.length === 0) return { eligible: false, reason: "no-active-sponsored-campaign" };
    const range = weekRange(isoWeek());
    const { data: session, error: sessionError } = await admin
      .from("skill_game_sessions")
      .select("session_id")
      .in("wallet_address", wallets)
      .eq("accepted", true)
      .in("game_type", gameTypes)
      .gte("created_at", range.from)
      .lt("created_at", range.to)
      .limit(1)
      .maybeSingle();
    if (sessionError) throw sessionError;
    return session ? { eligible: true, proofRef: `skill_game_session:${session.session_id}` } : { eligible: false, reason: "no-sponsored-session-this-week" };
  }

  return { eligible: false, reason: "unknown-quest" };
}

async function primaryVerifiedWallet(hubUserId: string): Promise<string | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("hub_user_wallets")
    .select("address, is_primary")
    .eq("user_id", hubUserId)
    .eq("verification_status", "verified")
    .order("is_primary", { ascending: false })
    .order("linked_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.address?.toLowerCase() ?? null;
}

async function computeWalletReward(wallet: string, basePoints: number) {
  const multiplier = Number(process.env.VAULT_QUEST_REWARD_MULTIPLIER ?? process.env.NEXT_PUBLIC_VAULT_QUEST_REWARD_MULTIPLIER ?? "1.5");
  const minimum = Number(process.env.VAULT_QUEST_BOOST_MIN_BALANCE ?? process.env.NEXT_PUBLIC_VAULT_QUEST_BOOST_MIN_BALANCE ?? "0.000001");
  const admin = createAdminClient();
  const { data } = await admin.from("vault_positions").select("balance_usdt").eq("wallet_address", wallet).maybeSingle();
  const balance = Number(data?.balance_usdt ?? 0);
  const applied = Number.isFinite(multiplier) && multiplier > 1 && Number.isFinite(balance) && balance >= minimum;
  return {
    awardedPoints: applied ? Math.ceil(basePoints * multiplier) : basePoints,
    vaultBoost: { applied, multiplier: Number.isFinite(multiplier) ? multiplier : 1, balanceUsdt: String(data?.balance_usdt ?? "0"), minBalanceUsdt: minimum },
  };
}

const STABLE_TOKENS = [
  "0x765DE816845861e75A25fCA122bb6898B8B1282a",
  "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
  "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
] as const;

async function verifyWalletClaimPolicy(wallet: string): Promise<HubQuestEvidence> {
  const admin = createAdminClient();
  const { data: blacklist, error: blacklistError } = await admin
    .from("blacklisted_addresses")
    .select("address")
    .eq("address", wallet)
    .maybeSingle();
  if (blacklistError) throw blacklistError;
  if (blacklist) return { eligible: false, reason: "blacklisted" };

  const client = createPublicClient({
    chain: celo,
    transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
  });
  const latest = await client.getBlock({ blockTag: "latest" });
  const holdDays = Number(process.env.MIN_STABLE_HOLD_DAYS ?? "1");
  const blocksBack = BigInt(Math.round((holdDays * 24 * 60 * 60) / 5));
  const historicalBlock = latest.number > blocksBack ? latest.number - blocksBack : 0n;
  const address = wallet as `0x${string}`;
  const current = await Promise.all(STABLE_TOKENS.map((token) => client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  })));
  const held = STABLE_TOKENS.filter((_, index) => current[index] > 0n);
  if (held.length === 0) return { eligible: false, reason: "no-stable-balance" };
  const historical = await Promise.all(held.map((token) => client.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    blockNumber: historicalBlock,
  })));
  return historical.some((balance) => balance > 0n)
    ? { eligible: true, proofRef: `stable-hold:${wallet}:${historicalBlock}` }
    : { eligible: false, reason: "stable-too-new" };
}

export async function claimHubCanonicalQuest(input: {
  hubUserId: string;
  email: string | null;
  questKey: string;
}) {
  const quest = getQuestCatalogEntry(input.questKey);
  if (!quest) throw new Error("unknown-quest");
  const wallets = await getLinkedWalletAddresses(input.hubUserId);
  const evidence = await verifyHubQuestEvidence({ quest, hubUserId: input.hubUserId, wallets });
  if (!evidence.eligible || !evidence.proofRef) {
    return { ok: false as const, code: "not-eligible" as const, reason: evidence.reason };
  }

  const canonicalId = await resolveHubQuestCanonical(input);
  const wallet = await primaryVerifiedWallet(input.hubUserId);
  if (wallet) {
    const walletPolicy = await verifyWalletClaimPolicy(wallet);
    if (!walletPolicy.eligible) {
      return { ok: false as const, code: "wallet-policy" as const, reason: walletPolicy.reason };
    }
  }
  const scopeKey = quest.frequency === "weekly" ? isoWeek() : "lifetime";
  const reward = wallet ? await computeWalletReward(wallet, quest.miles) : { awardedPoints: quest.miles, vaultBoost: null };
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("reserve_api_partner_quest_claim", {
    p_canonical_id: canonicalId,
    p_quest_key: quest.key,
    p_scope_key: scopeKey,
    p_verification_source: "hub-first-party",
    p_proof_ref: evidence.proofRef,
    p_claimed_from: "hub-page",
    p_delivery_mode: wallet ? "onchain_mint" : "offchain_ledger",
    p_destination_wallet: wallet,
    p_awarded_points: reward.awardedPoints,
  });
  if (error) throw error;
  const reservation = (Array.isArray(data) ? data[0] : data) as any;
  if (!reservation?.delivery_id) throw new Error("claim-reservation-failed");

  if (reservation.delivery_status === "completed") {
    return { ok: true as const, state: "completed" as const, points: Number(reservation.awarded_points), mode: reservation.delivery_mode };
  }
  if (!wallet) throw new Error("offchain-delivery-not-completed");

  if (reservation.delivery_status === "failed") {
    const { error: retryError } = await admin
      .from("api_partner_quest_reward_deliveries")
      .update({ status: "pending", last_error: null, updated_at: new Date().toISOString() })
      .eq("id", reservation.delivery_id)
      .eq("status", "failed");
    if (retryError) throw retryError;
  }

  const jobKey = quest.frequency === "weekly"
    ? `partner-weekly:${quest.reactPartnerQuestId}:${wallet}:${scopeKey}`
    : `partner:${quest.reactPartnerQuestId}:${wallet}`;
  const now = new Date().toISOString();
  const payload = quest.frequency === "weekly"
    ? {
        kind: "partner_weekly_engagement", userAddress: wallet,
        questId: quest.reactPartnerQuestId, isoWeek: scopeKey, claimedAt: now,
        pointsAwarded: reward.awardedPoints, basePoints: quest.miles,
        vaultBoost: reward.vaultBoost, canonicalDeliveryId: reservation.delivery_id,
      }
    : {
        kind: "partner_engagement", userAddress: wallet,
        questId: quest.reactPartnerQuestId, claimedAt: now,
        pointsAwarded: reward.awardedPoints, basePoints: quest.miles,
        vaultBoost: reward.vaultBoost, canonicalDeliveryId: reservation.delivery_id,
      };

  const { data: inserted, error: insertError } = await admin
    .from("minipoint_mint_jobs")
    .insert({
      idempotency_key: jobKey,
      user_address: wallet,
      points: reward.awardedPoints,
      reason: `partner-quest:${quest.reactPartnerQuestId}`,
      status: "pending",
      payload,
      api_partner_quest_delivery_id: reservation.delivery_id,
    })
    .select("id, status")
    .single();

  if (insertError && insertError.code !== "23505") {
    await admin.rpc("fail_api_partner_quest_delivery", {
      p_delivery_id: reservation.delivery_id,
      p_error: insertError.message,
    });
    throw insertError;
  }

  let job = inserted;
  if (!job) {
    const { data: existing, error: existingError } = await admin
      .from("minipoint_mint_jobs")
      .select("id, status")
      .eq("idempotency_key", jobKey)
      .maybeSingle();
    if (existingError) throw existingError;
    job = existing;
    if (job?.status === "failed") {
      const { data: revived, error: reviveError } = await admin
        .from("minipoint_mint_jobs")
        .update({ status: "pending", attempts: 0, last_error: null, available_at: now, processing_by: null, processing_started_at: null })
        .eq("id", job.id)
        .eq("status", "failed")
        .select("id, status")
        .maybeSingle();
      if (reviveError) throw reviveError;
      job = revived ?? job;
    }
  }

  return { ok: true as const, state: "reward_pending" as const, points: reward.awardedPoints, mode: "onchain_mint" as const, jobId: job?.id ?? null };
}

export { HUB_QUEST_CATALOG };
