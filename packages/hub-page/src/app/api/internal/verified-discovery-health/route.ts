// GET /api/internal/verified-discovery-health
// Operational telemetry for the verified-discovery hardening work
// (verified-discovery-market-readiness-hardening-spec.md §8.1/§8.2): photo
// processing queue depth/age, moderation queue depth/age, moderation audit
// integrity (every approved/rejected photo must have a domain audit event —
// §5.6's atomicity guarantee, checked here rather than just assumed),
// projection queue depth/age and snapshot staleness, and the current public-
// proof kill-switch state. Same auth convention as every other internal
// worker/health route in this codebase (x-webhook-secret / CRON_SECRET).
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerifiedDiscoveryPublicProofFlagsSummary } from "@/lib/akiba/verifiedDiscoveryPublicProofFlags";
import { isInternalWorkerRequest } from "@/lib/internalWorkerAuth";

const STUCK_PROCESSING_MINUTES = 10;
// §8.2: "projection lag exceeds 15 minutes for 15 consecutive minutes".
const PROJECTION_LAG_WARNING_MINUTES = 15;

type PhotoJobRow = { status: string; attempts: number; created_at: string; updated_at: string };
type ModerationPhotoRow = { id: string; moderation_status: string; submitted_at: string };
type ProjectionJobRow = { partner_id: string; status: string; attempts: number; created_at: string; updated_at: string };
type SnapshotRow = { partner_id: string; generated_at: string; suppression_reason: string | null };
type ModeratedPhotoRow = { id: string };

export async function GET(request: Request) {
  if (!isInternalWorkerRequest(request, true)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const stuckCutoff = Date.now() - STUCK_PROCESSING_MINUTES * 60_000;

  const [photoJobsResult, moderationResult, projectionJobsResult, snapshotsResult, auditedPhotosResult] = await Promise.all([
    admin
      .from("photo_processing_jobs")
      .select("status, attempts, created_at, updated_at")
      .in("status", ["pending", "processing", "failed"])
      .limit(5000),
    admin
      .from("merchant_visit_photos")
      .select("id, moderation_status, submitted_at")
      .eq("moderation_status", "pending")
      .order("submitted_at", { ascending: true })
      .limit(5000),
    admin
      .from("merchant_discovery_projection_jobs")
      .select("partner_id, status, attempts, created_at, updated_at")
      .in("status", ["pending", "processing", "failed"])
      .limit(5000),
    admin
      .from("merchant_discovery_public_snapshots")
      .select("partner_id, generated_at, suppression_reason")
      .is("suppression_reason", null)
      .limit(5000),
    admin
      .from("merchant_visit_photos")
      .select("id")
      .in("moderation_status", ["approved", "rejected"])
      .limit(5000),
  ]);

  const error =
    photoJobsResult.error ?? moderationResult.error ?? projectionJobsResult.error ??
    snapshotsResult.error ?? auditedPhotosResult.error;
  if (error) {
    console.error("[internal/verified-discovery-health] query failed:", error.message);
    return NextResponse.json({ error: "Verified-discovery health data is unavailable" }, { status: 503 });
  }

  const warnings: string[] = [];

  // Photo processing queue.
  const photoJobs = (photoJobsResult.data ?? []) as PhotoJobRow[];
  const photoQueue = { pending: 0, processing: 0, failed: 0 };
  let oldestPendingPhotoJobAgeMs = 0;
  const stuckPhotoJobs: PhotoJobRow[] = [];
  for (const job of photoJobs) {
    if (job.status === "pending") {
      photoQueue.pending++;
      oldestPendingPhotoJobAgeMs = Math.max(oldestPendingPhotoJobAgeMs, Date.now() - new Date(job.created_at).getTime());
    } else if (job.status === "processing") {
      photoQueue.processing++;
      if (new Date(job.updated_at).getTime() < stuckCutoff) stuckPhotoJobs.push(job);
    } else if (job.status === "failed") {
      photoQueue.failed++;
    }
  }
  if (stuckPhotoJobs.length > 0) {
    warnings.push(`${stuckPhotoJobs.length} photo processing job(s) stuck in 'processing' for over ${STUCK_PROCESSING_MINUTES} minutes`);
  }

  // Moderation queue.
  const moderationRows = (moderationResult.data ?? []) as ModerationPhotoRow[];
  const oldestPendingModerationAgeMs = moderationRows.length > 0
    ? Date.now() - new Date(moderationRows[0].submitted_at).getTime()
    : 0;

  // Audit integrity: every approved/rejected photo must have a domain audit
  // event (§5.6 atomicity; §8.2 "any moderation transition lacks its domain
  // audit event"). Anything here means a photo was moderated through a path
  // other than perform_visit_photo_transition.
  const auditedPhotoIds = (auditedPhotosResult.data ?? []) as ModeratedPhotoRow[];
  let missingAuditCount = 0;
  if (auditedPhotoIds.length > 0) {
    const { data: auditRows, error: auditError } = await admin
      .from("discovery_moderation_audit_events")
      .select("photo_id")
      .in("photo_id", auditedPhotoIds.map((p) => p.id));
    if (auditError) {
      console.error("[internal/verified-discovery-health] audit lookup failed:", auditError.message);
    } else {
      const auditedIds = new Set((auditRows ?? []).map((row: { photo_id: string }) => row.photo_id));
      missingAuditCount = auditedPhotoIds.filter((p) => !auditedIds.has(p.id)).length;
    }
  }
  if (missingAuditCount > 0) {
    warnings.push(`${missingAuditCount} moderated photo(s) have no domain audit event`);
  }

  // Projection queue (shadow-mode; §5.4).
  const projectionJobs = (projectionJobsResult.data ?? []) as ProjectionJobRow[];
  const projectionQueue = { pending: 0, processing: 0, failed: 0 };
  let oldestPendingProjectionJobAgeMs = 0;
  const stuckProjectionJobs: ProjectionJobRow[] = [];
  const failedPartners = new Set<string>();
  for (const job of projectionJobs) {
    if (job.status === "pending") {
      projectionQueue.pending++;
      oldestPendingProjectionJobAgeMs = Math.max(oldestPendingProjectionJobAgeMs, Date.now() - new Date(job.created_at).getTime());
    } else if (job.status === "processing") {
      projectionQueue.processing++;
      if (new Date(job.updated_at).getTime() < stuckCutoff) stuckProjectionJobs.push(job);
    } else if (job.status === "failed") {
      projectionQueue.failed++;
      failedPartners.add(job.partner_id);
    }
  }
  if (stuckProjectionJobs.length > 0) {
    warnings.push(`${stuckProjectionJobs.length} projection job(s) stuck in 'processing' for over ${STUCK_PROCESSING_MINUTES} minutes`);
  }
  const oldestPendingProjectionJobMinutes = oldestPendingProjectionJobAgeMs / 60_000;
  if (oldestPendingProjectionJobMinutes > PROJECTION_LAG_WARNING_MINUTES) {
    warnings.push(`Oldest pending projection job is ${Math.round(oldestPendingProjectionJobMinutes)} minute(s) old (budget ${PROJECTION_LAG_WARNING_MINUTES}m)`);
  }

  // Snapshot staleness (shadow-mode; nothing public reads these yet, but
  // staleness here is exactly what the eventual cutover's freshness gate
  // would alert on).
  const snapshots = (snapshotsResult.data ?? []) as SnapshotRow[];
  let oldestSnapshotAgeMs = 0;
  for (const snapshot of snapshots) {
    oldestSnapshotAgeMs = Math.max(oldestSnapshotAgeMs, Date.now() - new Date(snapshot.generated_at).getTime());
  }

  if (warnings.length > 0) {
    // Vercel Cron invokes this route every five minutes. A structured error
    // log gives the deployment's log alerting a stable signal without
    // including member, merchant, or photo identifiers.
    console.error("[verified-discovery-health] unhealthy", { warnings });
  }

  return NextResponse.json(
    {
      photoProcessingQueue: { ...photoQueue, oldestPendingAgeMs: oldestPendingPhotoJobAgeMs, stuck: stuckPhotoJobs.length },
      moderationQueue: { pending: moderationRows.length, oldestPendingAgeMs: oldestPendingModerationAgeMs, missingAuditCount },
      projectionQueue: {
        ...projectionQueue,
        oldestPendingAgeMs: oldestPendingProjectionJobAgeMs,
        stuck: stuckProjectionJobs.length,
        failedPartners: [...failedPartners],
      },
      snapshots: { count: snapshots.length, oldestAgeMs: oldestSnapshotAgeMs },
      publicProofFlags: getVerifiedDiscoveryPublicProofFlagsSummary(),
      healthy: warnings.length === 0,
      warnings,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
