// Shared with supabase/migrations/090_verified_discovery_hardening.sql's
// perform_visit_photo_transition CHECK — keep both lists in sync. An enum
// (not free text) is required so rejection reasons stay reportable and so
// the 64-character cap in the DB function can never be the thing rejecting
// a well-formed admin action (verified-discovery-market-readiness-
// hardening-spec.md §5.6).
export const DISCOVERY_PHOTO_REJECTION_REASONS = [
  { value: "policy_violation", label: "Policy violation" },
  { value: "identifiable_person", label: "Identifiable person" },
  { value: "low_quality", label: "Low quality" },
  { value: "not_merchant_related", label: "Not merchant-related" },
  { value: "receipt_or_personal_info", label: "Receipt or personal info" },
  { value: "duplicate_or_reused", label: "Duplicate or reused" },
  { value: "other", label: "Other" },
] as const;

export type DiscoveryPhotoRejectionReason = typeof DISCOVERY_PHOTO_REJECTION_REASONS[number]["value"];

const REASON_VALUES = new Set<string>(DISCOVERY_PHOTO_REJECTION_REASONS.map((reason) => reason.value));

export function isDiscoveryPhotoRejectionReason(value: unknown): value is DiscoveryPhotoRejectionReason {
  return typeof value === "string" && REASON_VALUES.has(value);
}
