// POST/GET /api/internal/process-discovery-projection-jobs
// Scheduled worker for the merchant discovery public-snapshot projection
// queue (verified-discovery-market-readiness-hardening-spec.md §5.4). Unlike
// the photo-processing worker, there is no decoding/storage work to do in
// Node — process_pending_merchant_discovery_projection_jobs claims jobs with
// FOR UPDATE SKIP LOCKED and recomputes each snapshot entirely in SQL, so
// this route is a thin trigger, kept as its own endpoint only to match the
// project's existing cron/webhook invocation convention.
//
// This queue and its snapshots are shadow-mode only (§12 Phase B): nothing
// in the public read path consumes merchant_discovery_public_snapshots yet.
// Running this worker populates and keeps that shadow data fresh for
// comparison ahead of a later cutover; it does not change what members see.
//
// Same dual-invocation convention as process-photo-jobs: POST with
// x-webhook-secret for manual/cross-app calls, GET with
// Authorization: Bearer <CRON_SECRET> for Vercel Cron.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

const BATCH_SIZE = 25;

async function processProjectionJobs() {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("process_pending_merchant_discovery_projection_jobs", {
    p_limit: BATCH_SIZE,
  });
  if (error) {
    console.error("[process-discovery-projection-jobs] claim/process failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const result = Array.isArray(data) ? data[0] : data;
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processProjectionJobs();
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processProjectionJobs();
}
