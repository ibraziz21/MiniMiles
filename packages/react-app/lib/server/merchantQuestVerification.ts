import { supabase } from "@/lib/supabaseClient";
import { isoWeek, weekRange } from "@/lib/games/week";
import {
  MERCHANT_DISCOVERY_QUEST_IDS,
  MERCHANT_QUEST_PROOF_DEAL_OPENED,
  MERCHANT_QUEST_PROOF_PASS_OPENED,
  QUEST_AKIBA_PASS,
  QUEST_BROWSE_DEALS,
  QUEST_COMPLETE_PROFILE,
  QUEST_REDEEM_VOUCHER,
  QUEST_SPONSORED_LEADERBOARD,
  type MerchantDiscoveryQuestId,
  type MerchantQuestStatus,
} from "@/lib/merchantDiscoveryQuests";

export type MerchantQuestVerification = {
  eligible: boolean;
  reason?: string;
};

type MerchantQuestMintJobState =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | undefined;

function throwQueryError(context: string, error: { message?: string } | null) {
  if (error) {
    throw new Error(`[merchant-quests] ${context}: ${error.message ?? "query failed"}`);
  }
}

export function isMerchantDiscoveryQuestId(
  value: string,
): value is MerchantDiscoveryQuestId {
  return (MERCHANT_DISCOVERY_QUEST_IDS as readonly string[]).includes(value);
}

async function hasActionProof(
  userAddress: string,
  questId: string,
  actionType: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("merchant_quest_action_proofs")
    .select("action_ref")
    .eq("user_address", userAddress)
    .eq("partner_quest_id", questId)
    .eq("action_type", actionType)
    .limit(1)
    .maybeSingle();

  throwQueryError("action proof lookup", error);
  return !!data;
}

async function activeSponsoredGameTypes(): Promise<string[] | null> {
  const weekMonday = weekRange(isoWeek()).from.slice(0, 10);
  const { data, error } = await supabase
    .from("game_weekly_campaigns")
    .select("game_types")
    .eq("active", true)
    .lte("week_from", weekMonday)
    .gt("week_to", weekMonday)
    .maybeSingle();

  throwQueryError("weekly campaign lookup", error);
  const gameTypes = Array.isArray(data?.game_types)
    ? data.game_types.filter((value): value is string => typeof value === "string")
    : [];
  return gameTypes.length > 0 ? gameTypes : null;
}

export async function verifyMerchantQuestAction(
  questId: string,
  userAddress: string,
): Promise<MerchantQuestVerification> {
  const userLc = userAddress.toLowerCase();

  if (questId === QUEST_AKIBA_PASS) {
    const verified = await hasActionProof(
      userLc,
      questId,
      MERCHANT_QUEST_PROOF_PASS_OPENED,
    );
    return verified
      ? { eligible: true }
      : { eligible: false, reason: "pass-onboarding-not-opened" };
  }

  if (questId === QUEST_BROWSE_DEALS) {
    const verified = await hasActionProof(
      userLc,
      questId,
      MERCHANT_QUEST_PROOF_DEAL_OPENED,
    );
    return verified
      ? { eligible: true }
      : { eligible: false, reason: "deal-not-opened" };
  }

  if (questId === QUEST_SPONSORED_LEADERBOARD) {
    const gameTypes = await activeSponsoredGameTypes();
    if (!gameTypes) {
      return { eligible: false, reason: "no-active-sponsored-campaign" };
    }

    const week = isoWeek();
    const { from, to } = weekRange(week);
    const { data, error } = await supabase
      .from("skill_game_sessions")
      .select("session_id")
      .eq("wallet_address", userLc)
      .eq("accepted", true)
      .in("game_type", gameTypes)
      .gte("created_at", from)
      .lt("created_at", to)
      .limit(1)
      .maybeSingle();

    throwQueryError("sponsored game session lookup", error);
    return data
      ? { eligible: true }
      : { eligible: false, reason: "no-sponsored-session-this-week" };
  }

  if (questId === QUEST_COMPLETE_PROFILE) {
    const { data, error } = await supabase
      .from("users")
      .select("country")
      .eq("user_address", userLc)
      .maybeSingle();

    throwQueryError("profile lookup", error);
    return data?.country
      ? { eligible: true }
      : { eligible: false, reason: "country-not-set" };
  }

  if (questId === QUEST_REDEEM_VOUCHER) {
    const { data, error } = await supabase
      .from("issued_vouchers")
      .select("id")
      .eq("user_address", userLc)
      .eq("status", "redeemed")
      .limit(1)
      .maybeSingle();

    throwQueryError("redeemed voucher lookup", error);
    return data
      ? { eligible: true }
      : { eligible: false, reason: "no-redeemed-voucher" };
  }

  return { eligible: true };
}

function mintJobKey(
  questId: MerchantDiscoveryQuestId,
  userAddress: string,
  week: string,
): string {
  return questId === QUEST_SPONSORED_LEADERBOARD
    ? `partner-weekly:${questId}:${userAddress}:${week}`
    : `partner:${questId}:${userAddress}`;
}

export function resolveMerchantQuestStatus(input: {
  questId: MerchantDiscoveryQuestId;
  jobState: MerchantQuestMintJobState;
  completed: boolean;
  verification: MerchantQuestVerification;
}): MerchantQuestStatus {
  const { questId, jobState, completed, verification } = input;

  if (jobState === "failed") {
    return { questId, state: "failed", reason: "reward-job-failed" };
  }
  if (jobState === "pending" || jobState === "processing") {
    return { questId, state: "queued" };
  }
  if (jobState === "completed" || completed) {
    return { questId, state: "completed" };
  }
  return verification.eligible
    ? { questId, state: "eligible" }
    : {
        questId,
        state: "needs_action",
        reason: verification.reason,
      };
}

export async function getMerchantQuestStatuses(
  userAddress: string,
): Promise<MerchantQuestStatus[]> {
  const userLc = userAddress.toLowerCase();
  const week = isoWeek();
  const oneTimeQuestIds = MERCHANT_DISCOVERY_QUEST_IDS.filter(
    (questId) => questId !== QUEST_SPONSORED_LEADERBOARD,
  );
  const jobKeys = MERCHANT_DISCOVERY_QUEST_IDS.map((questId) =>
    mintJobKey(questId, userLc, week),
  );

  const [engagementsResult, weeklyResult, jobsResult, verificationResults] =
    await Promise.all([
      supabase
        .from("partner_engagements")
        .select("partner_quest_id")
        .eq("user_address", userLc)
        .in("partner_quest_id", oneTimeQuestIds),
      supabase
        .from("partner_quest_weekly_claims")
        .select("iso_week")
        .eq("user_address", userLc)
        .eq("partner_quest_id", QUEST_SPONSORED_LEADERBOARD)
        .eq("iso_week", week)
        .maybeSingle(),
      supabase
        .from("minipoint_mint_jobs")
        .select("idempotency_key, status")
        .eq("user_address", userLc)
        .in("idempotency_key", jobKeys),
      Promise.all(
        MERCHANT_DISCOVERY_QUEST_IDS.map((questId) =>
          verifyMerchantQuestAction(questId, userLc),
        ),
      ),
    ]);

  throwQueryError("engagement status lookup", engagementsResult.error);
  throwQueryError("weekly status lookup", weeklyResult.error);
  throwQueryError("mint job status lookup", jobsResult.error);

  const completedIds = new Set(
    (engagementsResult.data ?? []).map((row) => row.partner_quest_id),
  );
  const jobsByKey = new Map(
    (jobsResult.data ?? []).map((row) => [row.idempotency_key, row.status]),
  );

  return MERCHANT_DISCOVERY_QUEST_IDS.map((questId, index) => {
    const jobState = jobsByKey.get(
      mintJobKey(questId, userLc, week),
    ) as MerchantQuestMintJobState;
    const isWeeklyCompleted =
      questId === QUEST_SPONSORED_LEADERBOARD && !!weeklyResult.data;
    const isCompleted = completedIds.has(questId) || isWeeklyCompleted;
    return resolveMerchantQuestStatus({
      questId,
      jobState,
      completed: isCompleted,
      verification: verificationResults[index],
    });
  });
}
