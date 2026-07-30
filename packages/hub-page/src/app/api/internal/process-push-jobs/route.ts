// POST/GET /api/internal/process-push-jobs
// Scheduled worker for web-push-notifications-spec.md §8. Claims a batch of
// eligible web_push_jobs (claim_web_push_jobs atomically flips them to
// 'processing' with FOR UPDATE SKIP LOCKED), sends each via web-push, and
// records the outcome via complete_web_push_job -- terminal states are never
// overwritten, transient failures retry with backoff.
//
// Same dual invocation path as process-reward-jobs:
//  - POST, x-webhook-secret header (INTERNAL_WEBHOOK_SECRET).
//  - GET, Authorization: Bearer <CRON_SECRET> (Vercel Cron; see vercel.json).

import { NextResponse } from "next/server";
import { processPushJobs } from "@/lib/push/dispatch";

export const dynamic = "force-dynamic";

async function handle() {
  const result = await processPushJobs();
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handle();
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return handle();
}
