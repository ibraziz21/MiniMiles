// POST/GET /api/internal/process-internal-event-jobs
// Manual recovery path for the internal_event_jobs outbox
// (hub-quest-event-delivery-spec.md §10) — packages/backend's
// HubQuestEventWorker is the production publisher; this route remains as an
// authenticated, operator-triggered fallback during migration, sharing the
// same lease-aware claim/complete RPCs (052_hub_quest_event_worker_leases.sql)
// so the two callers never fight over the same row.
//
// Two invocation paths, same convention as process-reward-jobs:
//  - POST, x-webhook-secret header (INTERNAL_WEBHOOK_SECRET).
//  - GET, Authorization: Bearer <CRON_SECRET> — Vercel Cron (retirement
//    tracked by spec §10; keep this only until the backend worker is proven).

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInternalEvent } from "@/lib/akiba/internal-events";

const BATCH_SIZE = 25;
const LEASE_SECONDS = 60;
const MAX_ATTEMPTS = 10;
const WORKER_ID = `vercel-recovery:${randomUUID().slice(0, 8)}`;

type ClaimedJob = {
  id: string;
  event_type: string;
  idempotency_key: string;
  identities: Array<{ type: string; value: string }>;
  occurred_at: string;
  metadata: Record<string, unknown>;
  attempts: number;
};

async function processInternalEventJobs() {
  const admin = createAdminClient();

  const { data: jobs, error: claimErr } = await admin.rpc("claim_internal_event_jobs", {
    p_limit: BATCH_SIZE,
    p_worker_id: WORKER_ID,
    p_lease_seconds: LEASE_SECONDS,
  });
  if (claimErr) {
    console.error("[process-internal-event-jobs] claim_internal_event_jobs failed:", claimErr.message);
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  const claimed = (jobs ?? []) as ClaimedJob[];

  let released = 0;
  let retried = 0;
  let failed = 0;

  for (const job of claimed) {
    const result = await sendInternalEvent({
      event_type: job.event_type,
      idempotency_key: job.idempotency_key,
      identities: job.identities as any,
      occurred_at: job.occurred_at,
      metadata: job.metadata,
    });

    const retryable = job.attempts < MAX_ATTEMPTS;
    const { error: completeErr } = await admin.rpc("complete_internal_event_job", {
      p_job_id: job.id,
      p_worker_id: WORKER_ID,
      p_ok: result.ok,
      p_retryable: retryable,
      p_error_code: result.ok ? null : "recovery_route_send_failed",
      p_error_detail: result.ok ? null : (result.error ?? "unknown error"),
    });
    if (completeErr) {
      console.error("[process-internal-event-jobs] complete_internal_event_job failed for job", job.id, completeErr.message);
      continue;
    }

    if (result.ok) released++;
    else if (retryable) retried++;
    else failed++;
  }

  return NextResponse.json({ ok: true, claimed: claimed.length, released, retried, failed });
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processInternalEventJobs();
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processInternalEventJobs();
}
