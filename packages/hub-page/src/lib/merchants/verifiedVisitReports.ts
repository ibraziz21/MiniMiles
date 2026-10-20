/**
 * Member reporting for verified-visit content (migration 104).
 *
 * Sibling of verifiedVisitHelpful.ts and deliberately shaped like it: the
 * same contribution_id key, the same eligibility check, the same
 * service-role-only access. Reporting is the reactive half of a moderation
 * model that is otherwise pre-publication.
 */
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Member-facing reasons. Bounded rather than free text so reports stay
 * countable and so nobody can paste personal data into the moderation queue.
 *
 * `moderatorReason` is the value a moderator would reach for in
 * admin-dashboard's DISCOVERY_PHOTO_REJECTION_REASONS when acting on this
 * report — recorded here so the two vocabularies never drift into needing a
 * human translation step.
 */
export const VERIFIED_VISIT_REPORT_REASONS = [
  { value: "offensive", label: "Hateful or abusive", moderatorReason: "policy_violation" },
  { value: "sexual_content", label: "Sexual content", moderatorReason: "policy_violation" },
  { value: "violence", label: "Violence or harm", moderatorReason: "policy_violation" },
  { value: "spam", label: "Spam or advertising", moderatorReason: "policy_violation" },
  { value: "shows_a_person", label: "Shows someone identifiable", moderatorReason: "identifiable_person" },
  { value: "personal_information", label: "Shows personal information", moderatorReason: "receipt_or_personal_info" },
  { value: "not_this_place", label: "Not about this place", moderatorReason: "not_merchant_related" },
  { value: "other", label: "Something else", moderatorReason: "other" },
] as const;

export type VerifiedVisitReportReason = (typeof VERIFIED_VISIT_REPORT_REASONS)[number]["value"];

const REASON_VALUES = new Set<string>(VERIFIED_VISIT_REPORT_REASONS.map((reason) => reason.value));

export function isVerifiedVisitReportReason(value: unknown): value is VerifiedVisitReportReason {
  return typeof value === "string" && REASON_VALUES.has(value);
}

/** The moderator rejection reason a given member report maps onto. */
export function moderatorReasonFor(reason: VerifiedVisitReportReason): string {
  return VERIFIED_VISIT_REPORT_REASONS.find((entry) => entry.value === reason)!.moderatorReason;
}

export type ReportOutcome =
  /** Stored. */
  | { ok: true; alreadyReported: false }
  /**
   * This member had already reported this card. Reported as success: the
   * member's intent is satisfied either way, and telling them "you already
   * did that" invites them to find another way to complain about the same
   * thing.
   */
  | { ok: true; alreadyReported: true }
  | { ok: false; error: string };

export async function reportVerifiedVisit(input: {
  hubUserId: string;
  contributionId: string;
  photoId: string | null;
  reason: VerifiedVisitReportReason;
}): Promise<ReportOutcome> {
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("merchant_verified_visit_reports")
    .upsert(
      {
        contribution_id: input.contributionId,
        photo_id: input.photoId,
        reporter_hub_user_id: input.hubUserId,
        reason_code: input.reason,
      },
      { onConflict: "contribution_id,reporter_hub_user_id", ignoreDuplicates: true },
    )
    .select("id");

  if (error) {
    console.error("[verified-visit-report] insert failed:", error.message);
    return { ok: false, error: error.message };
  }

  // ignoreDuplicates returns no row when the unique constraint already held,
  // which is how a repeat report is distinguished from a new one without a
  // second round trip.
  return { ok: true, alreadyReported: (data ?? []).length === 0 };
}

/** Pending reports for one card, for the moderation queue. */
export async function countPendingReports(contributionId: string): Promise<number> {
  const admin = createAdminClient();
  const { count, error } = await admin
    .from("merchant_verified_visit_reports")
    .select("id", { count: "exact", head: true })
    .eq("contribution_id", contributionId)
    .eq("status", "pending");

  if (error) {
    console.error("[verified-visit-report] pending count failed:", error.message);
    return 0;
  }
  return count ?? 0;
}
