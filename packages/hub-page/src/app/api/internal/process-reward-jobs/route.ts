// POST /api/internal/process-reward-jobs
// Scheduled worker (order-lifecycle-completion-spec.md §6 gate: "a Platform
// outage cannot lose a reward... retry eventually issues the reward exactly
// once"). Claims a batch of eligible reward_jobs (claim_reward_jobs atomically
// flips them to 'processing' with FOR UPDATE SKIP LOCKED, so an overlapping
// invocation can't double-claim), attempts Platform release for each, and
// records the outcome via complete_reward_job — success releases it, failure
// re-arms it with backoff instead of dropping it.
//
// This is the actual durability guarantee. The synchronous release attempt
// at order-completion time (lib/akiba/reward-release.ts) is just a fast path
// for the common case; this worker is what makes an outage self-heal.
//
// Two invocation paths:
//  - POST, x-webhook-secret header (INTERNAL_WEBHOOK_SECRET) — same
//    convention as other internal cross-app endpoints; for manual/cross-app
//    calls.
//  - GET, Authorization: Bearer <CRON_SECRET> — Vercel Cron always issues a
//    GET and can't set custom headers, but auto-injects this header when a
//    CRON_SECRET env var is configured; see vercel.json (every 5 minutes).

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPurchaseEvent } from "@/lib/akiba/purchase-events";
import type { PurchaseEventPayload } from "@/lib/akiba/purchase-events";
import { emitPurchaseCompletedQuest } from "@/lib/akiba/reward-release";

const BATCH_SIZE = 25;

async function processRewardJobs() {
  const admin = createAdminClient();

  const { data: jobs, error: claimErr } = await admin.rpc("claim_reward_jobs", { p_limit: BATCH_SIZE });
  if (claimErr) {
    console.error("[process-reward-jobs] claim_reward_jobs failed:", claimErr.message);
    return NextResponse.json({ error: claimErr.message }, { status: 500 });
  }

  const claimed = (jobs ?? []) as Array<{ id: string; order_id: string; payload: PurchaseEventPayload }>;

  let released = 0;
  let retried = 0;

  for (const job of claimed) {
    const result = await sendPurchaseEvent(job.payload);

    const { error: completeErr } = await admin.rpc("complete_reward_job", {
      p_job_id: job.id,
      p_ok: result.ok,
      p_error: result.ok ? null : (result.error ?? "unknown error"),
    });
    if (completeErr) {
      console.error("[process-reward-jobs] complete_reward_job failed for job", job.id, completeErr.message);
      continue;
    }

    if (result.ok) {
      released++;
      await emitPurchaseCompletedQuest(job.payload);
    } else {
      retried++;
    }
  }

  return NextResponse.json({ ok: true, claimed: claimed.length, released, retried });
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processRewardJobs();
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processRewardJobs();
}
