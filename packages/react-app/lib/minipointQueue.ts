import { supabase } from "@/lib/supabaseClient";

type DailyEngagementPayload = {
  kind: "daily_engagement";
  userAddress: string;
  questId: string;
  claimedAt: string;
  pointsAwarded: number;
  basePoints?: number;
  vaultBoost?: QuestVaultBoost;
};

type PartnerEngagementPayload = {
  kind: "partner_engagement";
  userAddress: string;
  questId: string;
  claimedAt: string;
  pointsAwarded: number;
  basePoints?: number;
  vaultBoost?: QuestVaultBoost;
};

type ProfileMilestonePayload = {
  kind: "profile_milestone";
  userAddress: string;
  milestone: 50 | 100;
};

type NewUserSignupPayload = {
  kind: "new_user_signup";
  userAddress: string;
};

type ReferralBonusPayload = {
  kind: "referral_bonus";
  userAddress: string;       // referrer
  referredAddress: string;   // the referred wallet that triggered the bonus
};

export type VaultDailyRewardPayload = {
  kind: "vault_daily_reward";
  userAddress: string;
  snapshotDate: string;      // YYYY-MM-DD
  balanceUsdt: string;       // principal at snapshot time (6-dec numeric as string)
  milesAwarded: number;
};

export type PollCompletionPayload = {
  kind: "poll_completion";
  userAddress: string;
  pollId: string;
  pollSlug: string;
  pointsAwarded: number;
  submittedAt: string;
};

type MintJobPayload =
  | DailyEngagementPayload
  | PartnerEngagementPayload
  | ProfileMilestonePayload
  | NewUserSignupPayload
  | ReferralBonusPayload
  | VaultDailyRewardPayload
  | PollCompletionPayload;

type MintJobRow = {
  id: string;
  idempotency_key: string;
  user_address: string;
  points: number;
  reason: string | null;
  status: "pending" | "processing" | "completed" | "failed";
  tx_hash: string | null;
  last_error: string | null;
  attempts: number;
  payload: MintJobPayload;
};

type QuestVaultBoost = {
  applied: boolean;
  multiplier: number;
  balanceUsdt?: string;
  minBalanceUsdt: number;
};

type QuestReward = {
  basePoints: number;
  awardedPoints: number;
  vaultBoost: QuestVaultBoost;
};

const VAULT_QUEST_REWARD_MULTIPLIER = Number(
  process.env.VAULT_QUEST_REWARD_MULTIPLIER ??
    process.env.NEXT_PUBLIC_VAULT_QUEST_REWARD_MULTIPLIER ??
    "1.5"
);
const VAULT_QUEST_BOOST_MIN_BALANCE = Number(
  process.env.VAULT_QUEST_BOOST_MIN_BALANCE ??
    process.env.NEXT_PUBLIC_VAULT_QUEST_BOOST_MIN_BALANCE ??
    "0.000001"
);

function isDuplicateError(error: any) {
  return error?.code === "23505";
}

async function getVaultBalanceUsdt(userAddress: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("vault_positions")
    .select("balance_usdt")
    .eq("wallet_address", userAddress.toLowerCase())
    .maybeSingle();

  if (error) {
    console.error("[minipointQueue] vault position lookup failed", error.message);
    return null;
  }

  return data?.balance_usdt == null ? null : String(data.balance_usdt);
}

async function computeQuestReward(userAddress: string, basePoints: number): Promise<QuestReward> {
  const multiplier =
    Number.isFinite(VAULT_QUEST_REWARD_MULTIPLIER) && VAULT_QUEST_REWARD_MULTIPLIER > 1
      ? VAULT_QUEST_REWARD_MULTIPLIER
      : 1;
  const minBalanceUsdt =
    Number.isFinite(VAULT_QUEST_BOOST_MIN_BALANCE) && VAULT_QUEST_BOOST_MIN_BALANCE > 0
      ? VAULT_QUEST_BOOST_MIN_BALANCE
      : 0;

  const balanceUsdt = multiplier > 1 ? await getVaultBalanceUsdt(userAddress) : null;
  const balance = Number(balanceUsdt ?? "0");
  const applied = multiplier > 1 && Number.isFinite(balance) && balance >= minBalanceUsdt;
  const awardedPoints = applied ? Math.ceil(basePoints * multiplier) : basePoints;

  return {
    basePoints,
    awardedPoints,
    vaultBoost: {
      applied,
      multiplier,
      balanceUsdt: balanceUsdt ?? undefined,
      minBalanceUsdt,
    },
  };
}

async function getMintJob(idempotencyKey: string): Promise<MintJobRow | null> {
  const { data, error } = await supabase
    .from("minipoint_mint_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) throw error;
  return data as MintJobRow | null;
}

async function ensureMintJob(opts: {
  idempotencyKey: string;
  userAddress: string;
  points: number;
  reason: string;
  payload: MintJobPayload;
}) {
  const { data, error } = await supabase
    .from("minipoint_mint_jobs")
    .insert({
      idempotency_key: opts.idempotencyKey,
      user_address: opts.userAddress.toLowerCase(),
      points: opts.points,
      reason: opts.reason,
      status: "pending",
      payload: opts.payload,
    })
    .select("*")
    .single();

  if (error && !isDuplicateError(error)) throw error;
  if (data) return data as MintJobRow;

  const raced = await getMintJob(opts.idempotencyKey);
  if (!raced) throw new Error(`Failed to create mint job ${opts.idempotencyKey}`);
  return raced;
}

// ── Public helpers ────────────────────────────────────────────────────────────

export async function claimQueuedDailyReward(opts: {
  userAddress: string;
  questId: string;
  points: number;
  scopeKey: string;
  reason: string;
}) {
  const { userAddress, questId, points, scopeKey, reason } = opts;
  const userLc = userAddress.toLowerCase();

  const { data: claimed, error: checkError } = await supabase
    .from("daily_engagements")
    .select("id")
    .eq("user_address", userLc)
    .eq("quest_id", questId)
    .eq("claimed_at", scopeKey)
    .maybeSingle();

  if (checkError) throw checkError;
  if (claimed) return { ok: false as const, code: "already" as const, scopeKey };

  const idempotencyKey = `daily:${questId}:${userLc}:${scopeKey}`;
  const reward = await computeQuestReward(userLc, points);

  await ensureMintJob({
    idempotencyKey,
    userAddress: userLc,
    points: reward.awardedPoints,
    reason,
    payload: {
      kind: "daily_engagement",
      userAddress: userLc,
      questId,
      claimedAt: scopeKey,
      pointsAwarded: reward.awardedPoints,
      basePoints: reward.basePoints,
      vaultBoost: reward.vaultBoost,
    },
  });

  return {
    ok: true as const,
    queued: true,
    txHash: undefined,
    scopeKey,
    points: reward.awardedPoints,
    basePoints: reward.basePoints,
    vaultBoost: reward.vaultBoost,
  };
}

export async function claimQueuedProfileMilestone(opts: {
  userAddress: string;
  milestone: 50 | 100;
  points: number;
}) {
  const { userAddress, milestone, points } = opts;
  const userLc = userAddress.toLowerCase();
  const idempotencyKey = `profile-milestone:${milestone}:${userLc}`;

  await ensureMintJob({
    idempotencyKey,
    userAddress: userLc,
    points,
    reason: `profile-milestone-${milestone}`,
    payload: { kind: "profile_milestone", userAddress: userLc, milestone },
  });

  return { ok: true as const, queued: true, txHash: undefined, points };
}

export async function claimQueuedPartnerReward(opts: {
  userAddress: string;
  questId: string;
  points: number;
  reason: string;
}) {
  const { userAddress, questId, points, reason } = opts;
  const userLc = userAddress.toLowerCase();

  const { data: existing, error: checkError } = await supabase
    .from("partner_engagements")
    .select("id")
    .eq("user_address", userLc)
    .eq("partner_quest_id", questId)
    .limit(1);

  if (checkError) throw checkError;
  if (existing && existing.length > 0) return { ok: false as const, code: "already" as const };

  const idempotencyKey = `partner:${questId}:${userLc}`;
  const reward = await computeQuestReward(userLc, points);

  await ensureMintJob({
    idempotencyKey,
    userAddress: userLc,
    points: reward.awardedPoints,
    reason,
    payload: {
      kind: "partner_engagement",
      userAddress: userLc,
      questId,
      claimedAt: new Date().toISOString(),
      pointsAwarded: reward.awardedPoints,
      basePoints: reward.basePoints,
      vaultBoost: reward.vaultBoost,
    },
  });

  return {
    ok: true as const,
    queued: true,
    txHash: undefined,
    minted: reward.awardedPoints,
    points: reward.awardedPoints,
    basePoints: reward.basePoints,
    vaultBoost: reward.vaultBoost,
  };
}

export async function enqueueSimpleMint(opts: {
  idempotencyKey: string;
  userAddress: string;
  points: number;
  reason: string;
  payload: NewUserSignupPayload | ReferralBonusPayload;
}) {
  await ensureMintJob(opts);
}

export async function claimQueuedPollReward(opts: {
  userAddress: string;
  pollId: string;
  pollSlug: string;
  points: number;
}) {
  const { userAddress, pollId, pollSlug, points } = opts;
  const userLc = userAddress.toLowerCase();
  const idempotencyKey = `poll-completion:${pollId}:${userLc}`;

  await ensureMintJob({
    idempotencyKey,
    userAddress: userLc,
    points,
    reason: `poll-completion:${pollSlug}`,
    payload: {
      kind: "poll_completion",
      userAddress: userLc,
      pollId,
      pollSlug,
      pointsAwarded: points,
      submittedAt: new Date().toISOString(),
    },
  });

  return { ok: true as const, queued: true, txHash: undefined, points };
}

export async function enqueueVaultDailyReward(opts: {
  userAddress: string;
  snapshotDate: string;   // YYYY-MM-DD
  balanceUsdt: string;    // numeric string e.g. "250.000000"
  miles: number;
}) {
  const { userAddress, snapshotDate, balanceUsdt, miles } = opts;
  const userLc = userAddress.toLowerCase();
  const idempotencyKey = `vault-daily-reward:${snapshotDate}:${userLc}`;

  await ensureMintJob({
    idempotencyKey,
    userAddress: userLc,
    points: miles,
    reason: `vault-daily-reward:${snapshotDate}`,
    payload: {
      kind: "vault_daily_reward",
      userAddress: userLc,
      snapshotDate,
      balanceUsdt,
      milesAwarded: miles,
    },
  });
}
