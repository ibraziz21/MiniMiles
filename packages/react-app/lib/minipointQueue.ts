import { supabase } from "@/lib/supabaseClient";

type DailyEngagementPayload = {
  kind: "daily_engagement";
  userAddress: string;
  questId: string;
  claimedAt: string;
  pointsAwarded: number;
};

type PartnerEngagementPayload = {
  kind: "partner_engagement";
  userAddress: string;
  questId: string;
  claimedAt: string;
  pointsAwarded: number;
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

function isDuplicateError(error: any) {
  return error?.code === "23505";
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

  await ensureMintJob({
    idempotencyKey,
    userAddress: userLc,
    points,
    reason,
    payload: {
      kind: "daily_engagement",
      userAddress: userLc,
      questId,
      claimedAt: scopeKey,
      pointsAwarded: points,
    },
  });

  return { ok: true as const, queued: true, txHash: undefined, scopeKey };
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

  await ensureMintJob({
    idempotencyKey,
    userAddress: userLc,
    points,
    reason,
    payload: {
      kind: "partner_engagement",
      userAddress: userLc,
      questId,
      claimedAt: new Date().toISOString(),
      pointsAwarded: points,
    },
  });

  return { ok: true as const, queued: true, txHash: undefined, minted: points };
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
