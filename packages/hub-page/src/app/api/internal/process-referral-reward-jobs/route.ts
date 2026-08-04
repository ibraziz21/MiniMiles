// POST/GET /api/internal/process-referral-reward-jobs
//
// Leased worker draining referral_reward_jobs (referral-system-spec.md
// §6.4, §8 "Internal worker route"). Same dual-auth convention as
// process-internal-event-jobs: POST + x-webhook-secret for the production
// worker/cron caller, GET + Authorization: Bearer CRON_SECRET for Vercel
// Cron as a recovery drain. Also sweeps expired activation windows/clicks
// and reclaims stale processing leases on every run, so a single scheduled
// hit keeps the whole referral reward pipeline healthy.
//
// Returns aggregate counts only — never referral/user identities (§8).
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { creditReferralReward, reverseReferralReward } from "@/lib/akiba/referral-rewards";
import { buildIdentities } from "@/lib/akiba/identities";

const BATCH_SIZE = 25;
const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 10;
const WORKER_ID = `vercel:${randomUUID().slice(0, 8)}`;

type ClaimedJob = {
  id: string;
  referral_id: string;
  milestone: "signup" | "activation";
  recipient_user_id: string;
  amount_miles: number;
  idempotency_key: string;
  attempts: number;
};

type ClaimedReversalJob = {
  id: string;
  referral_id: string;
  milestone: "signup" | "activation";
  amount_miles: number;
  idempotency_key: string;
  platform_reference: string | null;
  last_error_detail: string | null;
  attempts: number;
};

async function processReferralRewardJobs() {
  const admin = createAdminClient();

  await admin.rpc("release_expired_referral_reward_leases");
  await admin.rpc("expire_referrals", { p_batch_size: 500 });

  const { data: jobs, error: claimErr } = await admin.rpc("claim_referral_reward_jobs", {
    p_limit: BATCH_SIZE,
    p_worker_id: WORKER_ID,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claimErr) {
    console.error("[process-referral-reward-jobs] claim failed:", claimErr.message);
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  const claimed = (jobs ?? []) as ClaimedJob[];

  const referralIds = [...new Set(claimed.map((job) => job.referral_id))];
  const { data: referralPrograms, error: referralProgramsError } = referralIds.length
    ? await admin
        .from("hub_referrals")
        .select("id, program_version_id")
        .in("id", referralIds)
    : { data: [], error: null };
  if (referralProgramsError) {
    console.error("[process-referral-reward-jobs] failed to load bound program ids:", referralProgramsError.message);
  }

  const programIds = [...new Set(
    (referralPrograms ?? []).map((row: { program_version_id: string }) => row.program_version_id)
  )];
  const { data: programVersions, error: programVersionsError } = programIds.length
    ? await admin
        .from("referral_program_versions")
        .select("id, version")
        .in("id", programIds)
    : { data: [], error: null };
  if (programVersionsError) {
    console.error("[process-referral-reward-jobs] failed to load bound program versions:", programVersionsError.message);
  }

  const versionByProgramId = new Map(
    (programVersions ?? []).map((row: { id: string; version: number }) => [row.id, row.version])
  );
  const versionByReferralId = new Map(
    (referralPrograms ?? []).map((row: { id: string; program_version_id: string }) => [
      row.id,
      versionByProgramId.get(row.program_version_id),
    ])
  );

  let released = 0;
  let retried = 0;
  let manualReview = 0;

  for (const job of claimed) {
    const programVersion = versionByReferralId.get(job.referral_id);
    if (typeof programVersion !== "number") {
      const retryable = job.attempts < MAX_ATTEMPTS;
      const { error: completeErr } = await admin.rpc("complete_referral_reward_job", {
        p_job_id: job.id,
        p_worker_id: WORKER_ID,
        p_ok: false,
        p_retryable: retryable,
        p_platform_reference: null,
        p_error_code: "bound_program_version_missing",
        p_error_detail: "Could not resolve the referral's bound program version",
      });
      if (completeErr) {
        console.error("[process-referral-reward-jobs] failed to re-arm missing-version job", job.id, completeErr.message);
      } else if (retryable) {
        retried++;
      } else {
        manualReview++;
      }
      continue;
    }

    const { data: recipient } = await admin
      .from("hub_user_passes")
      .select("email")
      .eq("user_id", job.recipient_user_id)
      .maybeSingle();

    const identities = await buildIdentities({ userId: job.recipient_user_id, email: recipient?.email ?? null });

    const result = await creditReferralReward({
      idempotencyKey: job.idempotency_key,
      hubUserId: job.recipient_user_id,
      identities,
      amountMiles: job.amount_miles,
      milestone: job.milestone,
      programVersion,
      referralId: job.referral_id,
    });

    const retryable = !result.ok && result.retryable && job.attempts < MAX_ATTEMPTS;

    const { error: completeErr } = await admin.rpc("complete_referral_reward_job", {
      p_job_id: job.id,
      p_worker_id: WORKER_ID,
      p_ok: result.ok,
      p_retryable: retryable,
      p_platform_reference: result.ok ? result.ledgerReference : null,
      p_error_code: result.ok ? null : result.code,
      p_error_detail: result.ok ? null : result.error,
    });
    if (completeErr) {
      console.error("[process-referral-reward-jobs] complete_referral_reward_job failed for job", job.id, completeErr.message);
      continue;
    }

    if (result.ok) released++;
    else if (retryable) retried++;
    else manualReview++;
  }

  // ── Reversal delivery (referral-system-spec.md §3.5, Platform's
  //    POST /api/v1/referrals/reward/reverse contract) — separate claim
  //    from the credit pipeline above (056_referral_reversal_delivery.sql
  //    disambiguates by released_at, never mixing the two).
  const { data: reversalJobs, error: reversalClaimErr } = await admin.rpc("claim_referral_reversal_jobs", {
    p_limit: BATCH_SIZE,
    p_worker_id: WORKER_ID,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (reversalClaimErr) {
    console.error("[process-referral-reward-jobs] reversal claim failed:", reversalClaimErr.message);
  }

  const claimedReversals = (reversalJobs ?? []) as ClaimedReversalJob[];
  let reversed = 0;
  let reversalRetried = 0;
  let reversalManualReview = 0;

  for (const job of claimedReversals) {
    if (!job.platform_reference) {
      // A released job always gets a platform_reference on success
      // (complete_referral_reward_job) — this should be unreachable, but
      // there's nothing to reverse without it. Fail closed to manual_review
      // rather than guessing.
      await admin.rpc("complete_referral_reversal_job", {
        p_job_id: job.id,
        p_worker_id: WORKER_ID,
        p_ok: false,
        p_retryable: false,
        p_error_code: "missing_platform_reference",
        p_error_detail: "Job has no original platform_reference to reverse",
      });
      reversalManualReview++;
      continue;
    }

    const result = await reverseReferralReward({
      idempotencyKey: `${job.idempotency_key}:reversal`,
      ledgerReference: job.platform_reference,
      reason: job.last_error_detail ?? "referral_reward_reversed",
      metadata: { referralId: job.referral_id, milestone: job.milestone },
      expectedAmountMiles: job.amount_miles,
    });

    const retryable = !result.ok && result.retryable && job.attempts < MAX_ATTEMPTS;

    const { error: completeErr } = await admin.rpc("complete_referral_reversal_job", {
      p_job_id: job.id,
      p_worker_id: WORKER_ID,
      p_ok: result.ok,
      p_retryable: retryable,
      p_reversal_platform_reference: result.ok ? result.ledgerReference : null,
      p_error_code: result.ok ? null : result.code,
      p_error_detail: result.ok ? null : result.error,
    });
    if (completeErr) {
      console.error("[process-referral-reward-jobs] complete_referral_reversal_job failed for job", job.id, completeErr.message);
      continue;
    }

    if (result.ok) reversed++;
    else if (retryable) reversalRetried++;
    else reversalManualReview++;
  }

  return NextResponse.json({
    ok: true,
    claimed: claimed.length,
    released,
    retried,
    manualReview,
    reversalsClaimed: claimedReversals.length,
    reversed,
    reversalRetried,
    reversalManualReview,
  });
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processReferralRewardJobs();
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processReferralRewardJobs();
}
