/** Accepted working retention periods. These do not imply legal/ops sign-off. */
export const DELETION_RETENTION = {
  moderation: { days: 90 },
  security: { days: 180 },
  rewards: { days: 180 },
  referrals: { days: 180 },
  proof: { months: 24 },
} as const;

export type RetainedEvidenceCategory = Exclude<keyof typeof DELETION_RETENTION, "proof">;

/** No arbitrary source-row JSON, identifiers, notes or provider errors. */
export const EVIDENCE_FIELDS = {
  moderation: ["action", "reason_code", "before_status", "after_status", "occurred_at"],
  security: ["kind", "reason_code", "occurred_at", "resolved_at"],
  rewards: ["kind", "amount", "direction", "state", "occurred_at"],
  referrals: ["milestone", "amount_miles", "state", "occurred_at"],
} as const satisfies Record<RetainedEvidenceCategory, readonly string[]>;

/** Registry shared by admission and processing; no worker import cycle. */
export const IMPLEMENTED_DELETION_STEPS = new Set([
  "member_photo_objects", "saved_merchants", "published_photos", "unpublished_contributions",
  "profile_contact", "push_registrations", "reward_ledger",
  "settlement_evidence", "earning_events", "skill_game_prizes", "active_vouchers",
  "fraud_risk", "referrals", "pass_credentials", "notification_history",
  "deletion_record", "deletion_challenges",
]);

export const DELETION_IMPLEMENTATION_VERSION = "2026-10-19.1";
