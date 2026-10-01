// POST/GET /api/internal/process-photo-jobs
// Scheduled worker for Stage 2 first-party visit photos
// (verified-discovery-acquisition-v1-spec.md §13.2, §16.1, §17). Claims a
// batch of pending photo_processing_jobs (claim_photo_processing_jobs
// atomically flips them to 'processing' with FOR UPDATE SKIP LOCKED, same
// shape as claim_reward_jobs), downloads the private source upload,
// validates it's actually a decodable image (sharp fails closed on
// anything else — a stronger check than trusting the declared MIME type),
// strips EXIF/GPS by never propagating source metadata, re-encodes
// thumbnail + display derivatives, and records the outcome via
// complete_photo_processing_job — success moves the photo to `pending`
// admin moderation, failure re-arms the job with backoff (terminal after 6
// attempts, same policy as reward_jobs).
//
// Known gap for this pass: no perceptual/duplicate-image detection (§13.3
// "Same-image and near-duplicate detection limits gallery gaming") — that
// needs a hashing index this pass doesn't build. Flagged, not silently
// skipped.
//
// Same dual-invocation convention as process-reward-jobs: POST with
// x-webhook-secret for manual/cross-app calls, GET with
// Authorization: Bearer <CRON_SECRET> for Vercel Cron.

import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingPhotoJobs } from "@/lib/discovery/photoProcessing";

const BATCH_SIZE = 10;
const SOURCE_BUCKET = "discovery-visit-photos";
const STALE_UPLOAD_AGE_MS = 60 * 60 * 1000;
const STALE_UPLOAD_BATCH_SIZE = 100;

type StalePhotoUpload = {
  id: string;
  private_source_key: string;
};

/**
 * Signed upload intents create an `uploading` row before the browser sends
 * the object. The browser normally withdraws that row after a failed upload,
 * but it cannot do so when the intent response is lost or the page closes.
 * Reap those abandoned intents server-side so they do not consume one of the
 * contribution's three active-photo slots forever.
 *
 * The guarded status change happens before storage deletion. That is the
 * claim: if completion already moved a row to `processing`, it is absent from
 * the returned rows and its source object is never touched. A failed storage
 * deletion stays marked `upload_abandoned_cleanup_pending`, so a later cron
 * retries the private-object cleanup without making the row active again.
 */
async function cleanupStaleUploads(admin: ReturnType<typeof createAdminClient>): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_UPLOAD_AGE_MS).toISOString();
  const { data: candidates, error } = await admin
    .from("merchant_visit_photos")
    .select("id, private_source_key")
    .eq("moderation_status", "uploading")
    .lt("submitted_at", cutoff)
    .order("submitted_at", { ascending: true })
    .limit(STALE_UPLOAD_BATCH_SIZE);

  if (error) {
    console.error("[process-photo-jobs] stale upload lookup failed:", error.message);
  }

  const candidateIds = ((candidates ?? []) as StalePhotoUpload[]).map((photo) => photo.id);
  let newlyWithdrawn: StalePhotoUpload[] = [];
  if (candidateIds.length > 0) {
    const { data: claimed, error: claimError } = await admin
      .from("merchant_visit_photos")
      .update({
        moderation_status: "withdrawn",
        moderation_reason_code: "upload_abandoned_cleanup_pending",
        withdrawn_at: new Date().toISOString(),
      })
      .in("id", candidateIds)
      .eq("moderation_status", "uploading")
      .select("id, private_source_key");

    if (claimError) {
      console.error("[process-photo-jobs] stale upload claim failed:", claimError.message);
    } else {
      newlyWithdrawn = (claimed ?? []) as StalePhotoUpload[];
    }
  }

  // Include previously claimed rows whose Storage deletion failed on an
  // earlier invocation. Removing the same private key twice is harmless, and
  // the final guarded update makes overlapping cron runs converge.
  const { data: pendingCleanup, error: pendingError } = await admin
    .from("merchant_visit_photos")
    .select("id, private_source_key")
    .eq("moderation_status", "withdrawn")
    .eq("moderation_reason_code", "upload_abandoned_cleanup_pending")
    .order("withdrawn_at", { ascending: true })
    .limit(STALE_UPLOAD_BATCH_SIZE);

  if (pendingError) {
    console.error("[process-photo-jobs] pending source cleanup lookup failed:", pendingError.message);
    return newlyWithdrawn.length;
  }

  const cleanupById = new Map<string, StalePhotoUpload>();
  for (const photo of [...newlyWithdrawn, ...((pendingCleanup ?? []) as StalePhotoUpload[])]) {
    cleanupById.set(photo.id, photo);
  }
  const cleanup = [...cleanupById.values()].slice(0, STALE_UPLOAD_BATCH_SIZE);
  if (cleanup.length === 0) return newlyWithdrawn.length;

  const { error: removeError } = await admin.storage
    .from(SOURCE_BUCKET)
    .remove(cleanup.map((photo) => photo.private_source_key));
  if (removeError) {
    console.error("[process-photo-jobs] stale source cleanup failed:", removeError.message);
    return newlyWithdrawn.length;
  }

  const { error: finalizeError } = await admin
    .from("merchant_visit_photos")
    .update({ moderation_reason_code: "upload_abandoned" })
    .in("id", cleanup.map((photo) => photo.id))
    .eq("moderation_status", "withdrawn")
    .eq("moderation_reason_code", "upload_abandoned_cleanup_pending");

  if (finalizeError) {
    // The objects are already gone. Leaving cleanup_pending is safe; the next
    // run repeats an idempotent remove and retries this metadata update.
    console.error("[process-photo-jobs] stale source cleanup finalization failed:", finalizeError.message);
  }

  return newlyWithdrawn.length;
}

async function processPhotoJobs() {
  const admin = createAdminClient();

  const expiredUploads = await cleanupStaleUploads(admin);

  try {
    const result = await processPendingPhotoJobs(admin, BATCH_SIZE);
    return NextResponse.json({ ok: true, expiredUploads, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "photo_processing_failed";
    console.error("[process-photo-jobs] claim_photo_processing_jobs failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const secret = req.headers.get("x-webhook-secret");
  if (!secret || secret !== process.env.INTERNAL_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processPhotoJobs();
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET ?? "";
  const auth = req.headers.get("authorization") ?? "";
  if (!cronSecret || auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return processPhotoJobs();
}
