// Hub Quest Event Delivery, Slice C (hub-quest-event-delivery-spec.md §6) —
// Publisher for the internal_event_jobs outbox (Hub Supabase). Replaces the
// Vercel cron route as the production owner once proven healthy (§10); that
// route stays in place as an authenticated manual recovery path in the
// meantime and now shares this same lease-aware claim/complete RPC contract
// (052_hub_quest_event_worker_leases.sql), so both callers can coexist safely.
import * as dotenv from "dotenv";
dotenv.config();

import cron from "node-cron";
import { randomUUID } from "crypto";
import { supabase } from "./supabaseClient";
import { deliverHubQuestEvent, hubQuestEventAdapterConfigured, type ClaimedEventJob } from "./hubQuestEventAdapter";

const WORKER_ENABLED = process.env.HUB_QUEST_EVENT_WORKER_ENABLED === "true";
const BATCH_SIZE = Number(process.env.HUB_QUEST_EVENT_BATCH_SIZE ?? 25);
const LEASE_SECONDS = Number(process.env.HUB_QUEST_EVENT_LEASE_SECONDS ?? 60);
const MAX_ATTEMPTS = Number(process.env.HUB_QUEST_EVENT_MAX_ATTEMPTS ?? 10);
const CONCURRENCY = Math.max(1, Number(process.env.HUB_QUEST_EVENT_CONCURRENCY ?? 5));
const TIMEOUT_MS = Number(process.env.HUB_QUEST_EVENT_TIMEOUT_MS ?? 10000);

// 401/403 are treated as "retry briefly, then fail and alert" (spec §6.2)
// rather than riding the full MAX_ATTEMPTS runway — a bad credential won't
// fix itself on retry #7, and MAX_ATTEMPTS's exponential backoff could take
// hours to reach a human.
const CREDENTIAL_FAILURE_RETRY_LIMIT = 3;

const HUB_QUEST_EVENT_TYPES = [
  "pass_activated",
  "deal_viewed",
  "sponsored_game_played",
  "profile_country_set",
  "voucher_redeemed",
  "referral_activation_candidate",
] as const;

const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

export type DrainSummary = {
  claimed: number;
  released: number;
  retried: number;
  failed: number;
};

export type HubQuestEventHealth = {
  enabled: boolean;
  healthy: boolean;
  lastDrainAt: string | null;
  lastSuccessAt: string | null;
  pending: number;
  processing: number;
  failed: number;
  oldestPendingSeconds: number;
};

let isDraining = false;
let scheduled = false;
let lastDrainAt: string | null = null;
let lastSuccessAt: string | null = null;
let lastDrainOk = true;
let configValid: boolean | null = null;

// Validated once; production must fail the worker closed rather than send
// events with half-present configuration (spec §6.3). Other backend API
// routes are unaffected — only this worker's health reports unhealthy.
function validateConfig(): boolean {
  if (configValid !== null) return configValid;
  const problems: string[] = [];
  if (!process.env.SUPABASE_URL) problems.push("SUPABASE_URL is required");
  if (!process.env.SUPABASE_SERVICE_KEY) problems.push("SUPABASE_SERVICE_KEY is required");
  if (!hubQuestEventAdapterConfigured()) problems.push("AKIBA_API_URL and AKIBA_API_KEY are required");

  configValid = problems.length === 0;
  if (!configValid) {
    console.error("[hubQuestEventWorker] Disabled — invalid configuration:", problems.join("; "));
  }
  return configValid;
}

async function claimBatch(): Promise<ClaimedEventJob[]> {
  const { data, error } = await supabase.rpc("claim_internal_event_jobs", {
    p_limit: BATCH_SIZE,
    p_worker_id: WORKER_ID,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (error) throw error;
  return (data ?? []) as ClaimedEventJob[];
}

async function completeJob(
  jobId: string,
  ok: boolean,
  retryable: boolean,
  errorCode?: string,
  errorDetail?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("complete_internal_event_job", {
    p_job_id: jobId,
    p_worker_id: WORKER_ID,
    p_ok: ok,
    p_retryable: retryable,
    p_error_code: errorCode ?? null,
    p_error_detail: errorDetail ?? null,
  });
  if (error) {
    console.error(`[hubQuestEventWorker] complete_internal_event_job RPC failed for job ${jobId}:`, error.message);
    return;
  }
  if (data === false) {
    // Lease was lost to another worker (or already completed) between claim
    // and completion — not an error, just a race this worker lost.
    console.warn(`[hubQuestEventWorker] Lost lease on job ${jobId} before completing`);
  }
}

async function deliverReferralActivationCandidate(job: ClaimedEventJob): Promise<
  | { action: "release" }
  | { action: "retry"; errorCode: string; errorDetail: string }
  | { action: "fail"; errorCode: string; errorDetail: string; alert: boolean }
> {
  const referredUserId = job.metadata.referredUserId;
  const qualificationType = job.metadata.qualificationType;
  const qualificationReference = job.metadata.qualificationReference;
  const grossAmountKes = job.metadata.grossAmountKes;

  if (
    typeof referredUserId !== "string" ||
    typeof qualificationType !== "string" ||
    typeof qualificationReference !== "string" ||
    typeof grossAmountKes !== "number" ||
    !Number.isFinite(grossAmountKes)
  ) {
    return {
      action: "fail",
      errorCode: "invalid_referral_candidate",
      errorDetail: "Referral activation candidate metadata is incomplete",
      alert: true,
    };
  }

  const { data, error } = await supabase.rpc("qualify_referral_activation", {
    p_referred_user_id: referredUserId,
    p_qualification_type: qualificationType,
    p_qualification_reference: qualificationReference,
    p_gross_amount_kes: grossAmountKes,
    p_occurred_at: job.occurred_at,
  });
  if (error) {
    return { action: "retry", errorCode: "qualification_rpc_error", errorDetail: error.message };
  }

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; error_code?: string | null }
    | null;
  if (row?.ok) return { action: "release" };

  const terminal = new Set([
    "no_referral",
    "invalid_type",
    "predates_pass_creation",
    "activation_window_expired",
    "below_threshold",
    "duplicate_proof",
  ]);
  if (row?.error_code && terminal.has(row.error_code)) return { action: "release" };

  return {
    action: "retry",
    errorCode: row?.error_code ?? "qualification_failed",
    errorDetail: "Referral activation candidate could not be qualified",
  };
}

async function handleJob(job: ClaimedEventJob): Promise<"released" | "retried" | "failed"> {
  const outcome = job.event_type === "referral_activation_candidate"
    ? await deliverReferralActivationCandidate(job)
    : await deliverHubQuestEvent(job, TIMEOUT_MS);

  if (outcome.action === "release") {
    await completeJob(job.id, true, false);
    return "released";
  }

  if (outcome.action === "retry") {
    const isCredentialFailure = outcome.errorCode === "http_401" || outcome.errorCode === "http_403";
    if (isCredentialFailure) {
      console.error(
        `[hubQuestEventWorker] ALERT credential/scope failure (${outcome.errorCode}) delivering ${job.event_type} (attempt ${job.attempts})`,
      );
      if (job.attempts >= CREDENTIAL_FAILURE_RETRY_LIMIT) {
        await completeJob(job.id, false, false, outcome.errorCode, outcome.errorDetail);
        return "failed";
      }
    }
    await completeJob(job.id, false, job.attempts < MAX_ATTEMPTS, outcome.errorCode, outcome.errorDetail);
    return "retried";
  }

  if (outcome.alert) {
    console.error(`[hubQuestEventWorker] ALERT ${outcome.errorCode} delivering ${job.event_type}: ${outcome.errorDetail}`);
  }
  await completeJob(job.id, false, false, outcome.errorCode, outcome.errorDetail);
  return "failed";
}

async function drainOnce(): Promise<DrainSummary> {
  const summary: DrainSummary = { claimed: 0, released: 0, retried: 0, failed: 0 };
  const jobs = await claimBatch();
  summary.claimed = jobs.length;
  if (jobs.length === 0) return summary;

  let cursor = 0;
  async function lane(): Promise<void> {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      try {
        const result = await handleJob(job);
        summary[result === "released" ? "released" : result === "retried" ? "retried" : "failed"]++;
      } catch (err: any) {
        // One bad job must not stop the rest of the batch (spec §6.1 step 7).
        console.error(`[hubQuestEventWorker] Unhandled error delivering job ${job.id}:`, err?.message ?? err);
        await completeJob(job.id, false, job.attempts < MAX_ATTEMPTS, "worker_exception", String(err?.message ?? err).slice(0, 500));
        summary.retried++;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, lane));
  return summary;
}

export async function runHubQuestEventDrain(): Promise<DrainSummary> {
  const empty: DrainSummary = { claimed: 0, released: 0, retried: 0, failed: 0 };
  if (!WORKER_ENABLED || !validateConfig()) return empty;

  if (isDraining) {
    console.log("[hubQuestEventWorker] Already draining — skipping overlapping run");
    return empty;
  }

  isDraining = true;
  lastDrainAt = new Date().toISOString();
  try {
    const summary = await drainOnce();
    lastDrainOk = true;
    lastSuccessAt = new Date().toISOString();
    if (summary.claimed > 0) {
      console.log(
        `[hubQuestEventWorker] claimed=${summary.claimed} released=${summary.released} retried=${summary.retried} failed=${summary.failed}`,
      );
    }
    return summary;
  } catch (err: any) {
    lastDrainOk = false;
    console.error("[hubQuestEventWorker] Drain failed:", err?.message ?? err);
    return empty;
  } finally {
    isDraining = false;
  }
}

export async function startHubQuestEventWorker(): Promise<void> {
  if (!WORKER_ENABLED) {
    console.log("[hubQuestEventWorker] HUB_QUEST_EVENT_WORKER_ENABLED is not true — worker disabled");
    return;
  }
  if (!validateConfig()) return;
  if (scheduled) return;
  scheduled = true;

  console.log(`[hubQuestEventWorker] Starting (worker=${WORKER_ID}) — runs at startup, then every minute`);
  await runHubQuestEventDrain();

  cron.schedule("* * * * *", () => {
    runHubQuestEventDrain().catch((err) => console.error("[hubQuestEventWorker] Scheduled drain error:", err));
  });
}

// §12.3 — aggregate-only, never identities/metadata/idempotency keys/job IDs.
export async function getHubQuestEventHealth(): Promise<HubQuestEventHealth> {
  if (!WORKER_ENABLED) {
    return { enabled: false, healthy: true, lastDrainAt, lastSuccessAt, pending: 0, processing: 0, failed: 0, oldestPendingSeconds: 0 };
  }

  const { data, error } = await supabase
    .from("internal_event_jobs")
    .select("status, created_at")
    .in("event_type", HUB_QUEST_EVENT_TYPES as unknown as string[])
    .in("status", ["pending", "processing", "failed"])
    .limit(5000);

  if (error) {
    console.error("[hubQuestEventWorker] Health query failed:", error.message);
    return { enabled: true, healthy: false, lastDrainAt, lastSuccessAt, pending: 0, processing: 0, failed: 0, oldestPendingSeconds: 0 };
  }

  let pending = 0, processing = 0, failed = 0, oldestPendingMs = 0;
  const now = Date.now();
  for (const row of (data ?? []) as Array<{ status: string; created_at: string }>) {
    if (row.status === "pending") {
      pending++;
      oldestPendingMs = Math.max(oldestPendingMs, now - new Date(row.created_at).getTime());
    } else if (row.status === "processing") processing++;
    else if (row.status === "failed") failed++;
  }

  return {
    enabled: true,
    healthy: lastDrainOk && failed === 0,
    lastDrainAt,
    lastSuccessAt,
    pending,
    processing,
    failed,
    oldestPendingSeconds: Math.floor(oldestPendingMs / 1000),
  };
}
