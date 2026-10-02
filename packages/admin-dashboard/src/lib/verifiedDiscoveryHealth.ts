// Server-side computation backing the admin-dashboard "Discovery Health"
// page (verified-discovery-market-readiness-hardening-spec.md §8.1/§8.2,
// §8.3 "dashboards"). Deliberately mirrors
// packages/hub-page/src/app/api/internal/verified-discovery-health/route.ts
// rather than importing it — the two apps are separate deployments with
// separate dependency trees, and every other cross-app concern in this
// codebase (the rejection-reason enum, the UUID pattern) is kept in sync by
// comment cross-reference, not a shared package. Keep the two in sync by
// hand if either changes.
import { supabase } from "@/lib/supabase";

const STUCK_PROCESSING_MINUTES = 10;
const PROJECTION_LAG_WARNING_MINUTES = 15;

export type VerifiedDiscoveryHealth = {
  photoProcessingQueue: { pending: number; processing: number; failed: number; oldestPendingAgeMs: number; stuck: number };
  moderationQueue: { pending: number; oldestPendingAgeMs: number; missingAuditCount: number };
  projectionQueue: { pending: number; processing: number; failed: number; oldestPendingAgeMs: number; stuck: number; failedPartners: string[] };
  snapshots: { count: number; oldestAgeMs: number };
  healthy: boolean;
  warnings: string[];
  error: string | null;
};

type PhotoJobRow = { status: string; attempts: number; created_at: string; updated_at: string };
type ModerationPhotoRow = { id: string; submitted_at: string };
type ProjectionJobRow = { partner_id: string; status: string; attempts: number; created_at: string; updated_at: string };
type SnapshotRow = { partner_id: string; generated_at: string; suppression_reason: string | null };

export async function getVerifiedDiscoveryHealth(): Promise<VerifiedDiscoveryHealth> {
  const stuckCutoff = Date.now() - STUCK_PROCESSING_MINUTES * 60_000;

  const [photoJobsResult, moderationResult, projectionJobsResult, snapshotsResult, moderatedPhotosResult] = await Promise.all([
    supabase.from("photo_processing_jobs").select("status, attempts, created_at, updated_at").in("status", ["pending", "processing", "failed"]).limit(5000),
    supabase.from("merchant_visit_photos").select("id, submitted_at").eq("moderation_status", "pending").order("submitted_at", { ascending: true }).limit(5000),
    supabase.from("merchant_discovery_projection_jobs").select("partner_id, status, attempts, created_at, updated_at").in("status", ["pending", "processing", "failed"]).limit(5000),
    supabase.from("merchant_discovery_public_snapshots").select("partner_id, generated_at, suppression_reason").is("suppression_reason", null).limit(5000),
    supabase.from("merchant_visit_photos").select("id").in("moderation_status", ["approved", "rejected"]).limit(5000),
  ]);

  const error = photoJobsResult.error ?? moderationResult.error ?? projectionJobsResult.error ?? snapshotsResult.error ?? moderatedPhotosResult.error;
  if (error) {
    return {
      photoProcessingQueue: { pending: 0, processing: 0, failed: 0, oldestPendingAgeMs: 0, stuck: 0 },
      moderationQueue: { pending: 0, oldestPendingAgeMs: 0, missingAuditCount: 0 },
      projectionQueue: { pending: 0, processing: 0, failed: 0, oldestPendingAgeMs: 0, stuck: 0, failedPartners: [] },
      snapshots: { count: 0, oldestAgeMs: 0 },
      healthy: false,
      warnings: [],
      error: "Verified-discovery health data is unavailable",
    };
  }

  const warnings: string[] = [];

  const photoJobs = (photoJobsResult.data ?? []) as PhotoJobRow[];
  const photoQueue = { pending: 0, processing: 0, failed: 0 };
  let oldestPendingPhotoJobAgeMs = 0;
  let stuckPhotoJobs = 0;
  for (const job of photoJobs) {
    if (job.status === "pending") {
      photoQueue.pending++;
      oldestPendingPhotoJobAgeMs = Math.max(oldestPendingPhotoJobAgeMs, Date.now() - new Date(job.created_at).getTime());
    } else if (job.status === "processing") {
      photoQueue.processing++;
      if (new Date(job.updated_at).getTime() < stuckCutoff) stuckPhotoJobs++;
    } else if (job.status === "failed") {
      photoQueue.failed++;
    }
  }
  if (stuckPhotoJobs > 0) warnings.push(`${stuckPhotoJobs} photo processing job(s) stuck for over ${STUCK_PROCESSING_MINUTES} minutes`);

  const moderationRows = (moderationResult.data ?? []) as ModerationPhotoRow[];
  const oldestPendingModerationAgeMs = moderationRows.length > 0 ? Date.now() - new Date(moderationRows[0].submitted_at).getTime() : 0;

  const moderatedPhotoIds = (moderatedPhotosResult.data ?? []) as Array<{ id: string }>;
  let missingAuditCount = 0;
  if (moderatedPhotoIds.length > 0) {
    const { data: auditRows, error: auditError } = await supabase
      .from("discovery_moderation_audit_events")
      .select("photo_id")
      .in("photo_id", moderatedPhotoIds.map((p) => p.id));
    if (!auditError) {
      const auditedIds = new Set((auditRows ?? []).map((row: { photo_id: string }) => row.photo_id));
      missingAuditCount = moderatedPhotoIds.filter((p) => !auditedIds.has(p.id)).length;
    }
  }
  if (missingAuditCount > 0) warnings.push(`${missingAuditCount} moderated photo(s) have no domain audit event`);

  const projectionJobs = (projectionJobsResult.data ?? []) as ProjectionJobRow[];
  const projectionQueue = { pending: 0, processing: 0, failed: 0 };
  let oldestPendingProjectionJobAgeMs = 0;
  let stuckProjectionJobs = 0;
  const failedPartners = new Set<string>();
  for (const job of projectionJobs) {
    if (job.status === "pending") {
      projectionQueue.pending++;
      oldestPendingProjectionJobAgeMs = Math.max(oldestPendingProjectionJobAgeMs, Date.now() - new Date(job.created_at).getTime());
    } else if (job.status === "processing") {
      projectionQueue.processing++;
      if (new Date(job.updated_at).getTime() < stuckCutoff) stuckProjectionJobs++;
    } else if (job.status === "failed") {
      projectionQueue.failed++;
      failedPartners.add(job.partner_id);
    }
  }
  if (stuckProjectionJobs > 0) warnings.push(`${stuckProjectionJobs} projection job(s) stuck for over ${STUCK_PROCESSING_MINUTES} minutes`);
  const oldestPendingProjectionJobMinutes = oldestPendingProjectionJobAgeMs / 60_000;
  if (oldestPendingProjectionJobMinutes > PROJECTION_LAG_WARNING_MINUTES) {
    warnings.push(`Oldest pending projection job is ${Math.round(oldestPendingProjectionJobMinutes)} minute(s) old (budget ${PROJECTION_LAG_WARNING_MINUTES}m)`);
  }

  const snapshots = (snapshotsResult.data ?? []) as SnapshotRow[];
  let oldestSnapshotAgeMs = 0;
  for (const snapshot of snapshots) {
    oldestSnapshotAgeMs = Math.max(oldestSnapshotAgeMs, Date.now() - new Date(snapshot.generated_at).getTime());
  }

  return {
    photoProcessingQueue: { ...photoQueue, oldestPendingAgeMs: oldestPendingPhotoJobAgeMs, stuck: stuckPhotoJobs },
    moderationQueue: { pending: moderationRows.length, oldestPendingAgeMs: oldestPendingModerationAgeMs, missingAuditCount },
    projectionQueue: { ...projectionQueue, oldestPendingAgeMs: oldestPendingProjectionJobAgeMs, stuck: stuckProjectionJobs, failedPartners: [...failedPartners] },
    snapshots: { count: snapshots.length, oldestAgeMs: oldestSnapshotAgeMs },
    healthy: warnings.length === 0,
    warnings,
    error: null,
  };
}
