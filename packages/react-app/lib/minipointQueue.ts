import { randomUUID } from "crypto";
import { supabase } from "@/lib/supabaseClient";
import { safeMintMiniPoints } from "@/lib/minipoints";

const LOCK_NAME = "default";
const LOCK_LEASE_SECONDS = 30;
const MAX_JOB_ATTEMPTS = 6;

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

type MintJobPayload = DailyEngagementPayload | PartnerEngagementPayload;

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

function errorMessage(error: any) {
  return error?.shortMessage ?? error?.message ?? "mint-queue-error";
}

async function getMintJob(idempotencyKey: string): Promise<MintJobRow | null> {
  const { data, error } = await supabase
    .from("minipoint_mint_jobs")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data as MintJobRow | null;
}

async function ensureMintJob(opts: {
  idempotencyKey: string;
  userAddress: string;
  points: number;
  reason: string;
  payload: MintJobPayload;
}) {
  const existing = await getMintJob(opts.idempotencyKey);
  if (existing) return existing;

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

  if (error && !isDuplicateError(error)) {
    throw error;
  }

  if (data) return data as MintJobRow;

  const raced = await getMintJob(opts.idempotencyKey);
  if (!raced) {
    throw new Error(`Failed to create mint job ${opts.idempotencyKey}`);
  }
  return raced;
}

async function applyMintPayload(payload: MintJobPayload) {
  if (payload.kind === "daily_engagement") {
    const { error } = await supabase.from("daily_engagements").insert({
      user_address: payload.userAddress,
      quest_id: payload.questId,
      claimed_at: payload.claimedAt,
      points_awarded: payload.pointsAwarded,
    });

    if (error && !isDuplicateError(error)) {
      throw error;
    }
    return;
  }

  const { error } = await supabase.from("partner_engagements").insert({
    user_address: payload.userAddress,
    partner_quest_id: payload.questId,
    claimed_at: payload.claimedAt,
    points_awarded: payload.pointsAwarded,
  });

  if (error && !isDuplicateError(error)) {
    throw error;
  }
}

export async function processMintQueue(opts?: { maxJobs?: number }) {
  const maxJobs = opts?.maxJobs ?? 5;
  const owner = randomUUID();

  const { data: acquired, error: lockError } = await supabase.rpc(
    "acquire_minipoint_mint_queue_lock",
    {
      p_lock_name: LOCK_NAME,
      p_owner: owner,
      p_lease_seconds: LOCK_LEASE_SECONDS,
    }
  );

  if (lockError) {
    throw lockError;
  }

  if (!acquired) {
    return { acquired: false as const, processed: 0 };
  }

  let processed = 0;

  try {
    for (let i = 0; i < maxJobs; i++) {
      const { data, error } = await supabase.rpc(
        "claim_next_minipoint_mint_job",
        {
          p_lock_name: LOCK_NAME,
          p_owner: owner,
        }
      );

      if (error) {
        throw error;
      }

      const job = (Array.isArray(data) ? data[0] : data) as MintJobRow | null;
      if (!job) break;

      try {
        const txHash = await safeMintMiniPoints({
          to: job.user_address as `0x${string}`,
          points: job.points,
          reason: job.reason ?? undefined,
        });

        await applyMintPayload(job.payload);

        const { error: completeError } = await supabase.rpc(
          "complete_minipoint_mint_job",
          {
            p_job_id: job.id,
            p_tx_hash: txHash,
          }
        );

        if (completeError) {
          throw completeError;
        }

        processed += 1;
      } catch (error: any) {
        const message = errorMessage(error);

        if ((job.attempts ?? 0) >= MAX_JOB_ATTEMPTS) {
          await supabase.rpc("fail_minipoint_mint_job", {
            p_job_id: job.id,
            p_error: message,
          });
          continue;
        }

        await supabase.rpc("retry_minipoint_mint_job", {
          p_job_id: job.id,
          p_error: message,
          p_delay_seconds: Math.min(30, 2 ** Math.max(1, job.attempts ?? 1)),
        });
      }
    }
  } finally {
    await supabase.rpc("release_minipoint_mint_queue_lock", {
      p_lock_name: LOCK_NAME,
      p_owner: owner,
    });
  }

  return { acquired: true as const, processed };
}

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

  if (checkError) {
    throw checkError;
  }

  if (claimed) {
    return { ok: false as const, code: "already" as const, scopeKey };
  }

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

  await processMintQueue({ maxJobs: 5 });

  const job = await getMintJob(idempotencyKey);
  if (!job) {
    throw new Error(`Mint job missing after enqueue: ${idempotencyKey}`);
  }

  if (job.status === "failed") {
    return {
      ok: false as const,
      code: "error" as const,
      scopeKey,
      message: job.last_error ?? "Mint queue failed",
    };
  }

  return {
    ok: true as const,
    queued: job.status !== "completed",
    txHash: job.tx_hash ?? undefined,
    scopeKey,
  };
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

  if (checkError) {
    throw checkError;
  }

  if (existing && existing.length > 0) {
    return { ok: false as const, code: "already" as const };
  }

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

  await processMintQueue({ maxJobs: 5 });

  const job = await getMintJob(idempotencyKey);
  if (!job) {
    throw new Error(`Mint job missing after enqueue: ${idempotencyKey}`);
  }

  if (job.status === "failed") {
    return {
      ok: false as const,
      code: "error" as const,
      message: job.last_error ?? "Mint queue failed",
    };
  }

  return {
    ok: true as const,
    queued: job.status !== "completed",
    txHash: job.tx_hash ?? undefined,
    minted: points,
  };
}
