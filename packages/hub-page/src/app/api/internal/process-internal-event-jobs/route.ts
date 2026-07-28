// POST/GET /api/internal/process-internal-event-jobs
// Scheduled worker for the internal_event_jobs outbox
// (044_internal_event_outbox.sql) — same durability shape as
// process-reward-jobs: claim_internal_event_jobs atomically flips a batch to
// 'processing' (FOR UPDATE SKIP LOCKED), each job is sent to Platform via
// sendInternalEvent, and complete_internal_event_job records the outcome —
// success releases it, failure re-arms it with backoff. This is what makes
// pass_activated/voucher_redeemed/purchase_reversed durable rather than
// fire-and-forget: a Platform outage retries here instead of losing the
// quest completion.
//
// Two invocation paths, same convention as process-reward-jobs:
//  - POST, x-webhook-secret header (INTERNAL_WEBHOOK_SECRET).
//  - GET, Authorization: Bearer <CRON_SECRET> — Vercel Cron.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInternalEvent } from "@/lib/akiba/internal-events";

const BATCH_SIZE = 25;

type ClaimedJob = {
  id: string;
  event_type: string;
  idempotency_key: string;
  identities: Array<{ type: string; value: string }>;
  occurred_at: string;
  metadata: Record<string, unknown>;
};

async function processInternalEventJobs() {
  const admin = createAdminClient();

  const { data: jobs, error: claimErr } = await admin.rpc("claim_internal_event_jobs", { p_limit: BATCH_SIZE });
  if (claimErr) {
    console.error("[process-internal-event-jobs] claim_internal_event_jobs failed:", claimErr.message);
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  const claimed = (jobs ?? []) as ClaimedJob[];

  let released = 0;
  let retried = 0;

  for (const job of claimed) {
    const result = await sendInternalEvent({
      event_type: job.event_type,
      idempotency_key: job.idempotency_key,
      identities: job.identities as any,
      occurred_at: job.occurred_at,
      metadata: job.metadata,
    });

    const { error: completeErr } = await admin.rpc("complete_internal_event_job", {
      p_job_id: job.id,
      p_ok: result.ok,
      p_error: result.ok ? null : (result.error ?? "unknown error"),
    });
    if (completeErr) {
      console.error("[process-internal-event-jobs] complete_internal_event_job failed for job", job.id, completeErr.message);
      continue;
    }

    if (result.ok) released++;
    else retried++;
  }

  return NextResponse.json({ ok: true, claimed: claimed.length, released, retried });
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
