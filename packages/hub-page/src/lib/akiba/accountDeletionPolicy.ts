/**
 * Account-deletion policy constants and the versioned retention inventory
 * (AKIBA-MOB-002 §9).
 *
 * The inventory is code, not a wiki page, for one reason: §9 says no
 * production feature flag may enable deletion processing while an inventory
 * row is `TBD`, and `assertInventoryApproved` is what makes that a build-time
 * and run-time fact rather than a promise. Rows whose `retention` is null are
 * unapproved; the worker refuses to process while any remain.
 *
 * Every row records what §9 demands for retained classes — purpose, lawful
 * basis, exact period, fields kept, pseudonymization method, who may read it,
 * processor/region, review cadence, and the end-of-period action. The rows
 * left null here are the ones that need Akiba's data-protection owner, not an
 * engineer, to answer.
 */

/**
 * Bump whenever the member-facing deletion copy or the retention map changes
 * in a way a member would need to re-acknowledge. The request API accepts
 * only this value, so an app build showing older copy is rejected rather than
 * silently recording consent to a policy the member never saw.
 */
export const DELETION_POLICY_VERSION = "2026-10-10.1";

/** §4.5 — the member-facing maximum processing target, in calendar days. */
export const PROCESSING_TARGET_DAYS = 14;

/** §7.2 — challenge lifetime and attempt budget. */
export const CHALLENGE_TTL_SECONDS = 600;
export const CHALLENGE_MAX_ATTEMPTS = 5;

/** Request states that block normal access to protected v1 routes (§7.4). */
export const PENDING_DELETION_STATUSES = ["requested", "processing", "legal_hold", "failed"] as const;

export type DeletionAction =
  /** Row or object is removed outright. */
  | "delete"
  /** Row is kept, but every direct identifier is replaced. */
  | "pseudonymize"
  /** Credential/entitlement is invalidated; its audit trail is kept. */
  | "revoke"
  /** Association between Akiba and an external system is severed. */
  | "unlink"
  /** Handled by an external processor; Akiba records only the outcome. */
  | "processor"
  /** Outside Akiba's control — public chain. Never presented as deleted. */
  | "immutable";

export type RetentionTerms = {
  purpose: string;
  lawfulBasis: string;
  /** Exact period. `null` is not allowed here — use a null `retention` instead. */
  periodDays: number;
  fieldsRetained: string[];
  pseudonymizationMethod: string;
  accessRoles: string[];
  processor: string;
  storageRegion: string;
  reviewCadence: string;
  endOfPeriodAction: string;
};

export type InventoryRow = {
  /** Stable id used in worker step markers and event metadata. */
  id: string;
  dataClass: string;
  /** Tables, buckets, or processors this row covers. */
  targets: string[];
  action: DeletionAction;
  /**
   * Approved retention terms, or `null` when the data-protection owner has
   * not signed the row off yet. A null here blocks production processing.
   */
  retention: RetentionTerms | null;
  notes: string;
};

const NO_RETENTION_NEEDED: RetentionTerms = {
  purpose: "None — deleted on request",
  lawfulBasis: "Erasure of data no longer necessary to retain",
  periodDays: 0,
  fieldsRetained: [],
  pseudonymizationMethod: "n/a — row removed",
  accessRoles: [],
  processor: "Supabase (Akiba project)",
  storageRegion: "See Supabase project region",
  reviewCadence: "n/a",
  endOfPeriodAction: "Deleted during request processing",
};

/**
 * The inventory. Targets are the real tables in supabase/migrations — each
 * was read off the schema, not assumed, because a deletion worker aimed at a
 * table that does not exist fails silently and one aimed at the wrong column
 * deletes someone else's data.
 */
export const DELETION_INVENTORY: InventoryRow[] = [
  {
    id: "auth_identity",
    dataClass: "Supabase Auth identity and sessions",
    targets: ["auth.users"],
    action: "delete",
    retention: NO_RETENTION_NEEDED,
    notes: "Soft-deleted with the service role, only after every dependent step succeeds.",
  },
  {
    id: "profile_contact",
    dataClass: "Email, phone, name, username, city, avatar",
    targets: ["hub_user_profiles", "leaderboard_profiles", "leaderboard_username_changes"],
    action: "delete",
    retention: NO_RETENTION_NEEDED,
    notes: "Includes the duplicated leaderboard username projection, not just the profile row.",
  },
  {
    id: "pass_credentials",
    dataClass: "Pass and presentation secrets",
    targets: ["hub_user_passes"],
    action: "delete",
    retention: null,
    notes:
      "TBD, and blocked by a schema dependency, not just a period: " +
      "hub_referrals.referred_pass_id is NOT NULL REFERENCES hub_user_passes(id) with no " +
      "ON DELETE action, so a referred member's pass cannot be deleted until the `referrals` " +
      "row is decided. If referrals are pseudonymised rather than deleted, that column has to " +
      "be repointed or made nullable first. Deleting the pass is otherwise unambiguous — no " +
      "valid Pass credential may survive processing.",
  },
  {
    id: "saved_merchants",
    dataClass: "Saved merchants and preferences",
    targets: ["hub_user_saved_merchants", "hub_notification_preferences"],
    action: "delete",
    retention: NO_RETENTION_NEEDED,
    notes: "No retention purpose.",
  },
  {
    id: "push_registrations",
    dataClass: "Push/device registrations",
    targets: ["web_push_deliveries", "web_push_jobs", "web_push_subscriptions"],
    action: "delete",
    retention: NO_RETENTION_NEEDED,
    notes:
      "Covers queued sends and delivery rows as well as endpoints; native device tokens join here " +
      "when they ship. Delivery rows must go first — web_push_deliveries.subscription_id has no " +
      "ON DELETE action, and a campaign job's deliveries can point at this member's subscription.",
  },
  {
    id: "wallet_links",
    dataClass: "Linked-wallet relationship",
    targets: ["hub_user_wallets", "wallet_link_challenges"],
    action: "unlink",
    retention: NO_RETENTION_NEEDED,
    notes: "Severs Akiba's association only. The external wallet and its chain history are untouched.",
  },
  {
    id: "deletion_challenges",
    dataClass: "Account-deletion challenges",
    targets: ["account_deletion_challenges"],
    action: "delete",
    retention: NO_RETENTION_NEEDED,
    notes: "Transient verification state with no evidentiary value once the request exists.",
  },
  {
    id: "unpublished_contributions",
    dataClass: "Unpublished discovery answers/photos",
    // Targets are grouped by foreign-key depth, not by how the data class
    // reads: the request layer is the *parent* of everything in
    // `published_photos`, so it has to be its own, later step.
    targets: ["merchant_discovery_item_mentions", "discovery_contribution_requests"],
    action: "delete",
    retention: null,
    notes:
      "TBD because it sits upstream of `published_photos` in the same foreign-key chain: " +
      "merchant_discovery_contributions.request_id and merchant_visit_photos.contribution_id are " +
      "both NOT NULL with no ON DELETE action, so the request row cannot go while any photo row " +
      "survives. Resolve `published_photos` first; this row then follows it.",
  },
  {
    id: "member_photo_objects",
    dataClass: "Member photo Storage objects",
    targets: ["storage:discovery-visit-photos", "storage:discovery-visit-photos-derived"],
    action: "delete",
    retention: NO_RETENTION_NEEDED,
    notes:
      "The image bytes themselves, which go regardless of how `published_photos` is resolved. " +
      "Runs before any row deletion for two reasons: the object keys live on the photo rows, and " +
      "Supabase refuses to delete an Auth user that still owns Storage objects.",
  },
  {
    id: "published_photos",
    dataClass: "Published member photos/content",
    // Includes the in-flight processing jobs and contribution items, which
    // are children of the photo/contribution rows and must go in the same
    // step rather than a later one — see `unpublished_contributions`.
    targets: [
      "photo_processing_jobs",
      "merchant_discovery_contribution_items",
      "merchant_visit_photos",
      "merchant_discovery_contributions",
    ],
    // Not "delete" any more: the schema proves a plain delete is impossible
    // for a moderated photo, so the real options are both forms of
    // retention and the choice between them is the approval.
    action: "pseudonymize",
    retention: null,
    notes:
      "TBD, and a proven conflict rather than a missing period: " +
      "discovery_moderation_audit_events.photo_id is NOT NULL REFERENCES merchant_visit_photos(id), " +
      "and that table is deliberately append-only ('cannot be updated or deleted through any " +
      "application role', 090_verified_discovery_hardening.sql). So a moderated photo's row cannot " +
      "be deleted. Two candidate resolutions, both needing sign-off: (a) keep the photo row, " +
      "pseudonymise hub_user_id and null the storage keys, or (b) delete rows only where no " +
      "moderation audit exists and pseudonymise the rest. Either way the image bytes go — see " +
      "`member_photo_objects`, which is approved and runs first.",
  },

  // ── Rows below need the data-protection owner's sign-off (§9, §20) ─────
  // Each is a real retention question, not an engineering gap: the lawful
  // basis and period decide whether the worker deletes or pseudonymizes.
  {
    id: "active_vouchers",
    dataClass: "Active account-bound vouchers",
    targets: ["issued_vouchers", "voucher_claim_intents"],
    action: "revoke",
    retention: null,
    notes: "TBD: period for the issuance/redemption audit that must survive voiding.",
  },
  {
    id: "reward_ledger",
    dataClass: "Miles/reward ledger",
    targets: ["miles_ledger_holds", "miles_spend_intents"],
    action: "pseudonymize",
    retention: null,
    notes: "TBD: accounting/settlement period and which fields stay after de-linking.",
  },
  {
    id: "settlement_evidence",
    dataClass: "Voucher redemption, settlement, payment evidence",
    targets: ["voucher_redemptions", "voucher_purchase_quotes", "mpesa_stk_requests"],
    action: "pseudonymize",
    retention: null,
    notes: "TBD: statutory accounting period; M-Pesa evidence may have its own minimum.",
  },
  {
    id: "earning_events",
    dataClass: "Verified earning and quest evidence",
    targets: ["verified_earning_events", "hub_quest_action_proofs", "hub_user_canonicals"],
    action: "pseudonymize",
    retention: null,
    notes: "TBD: fraud/settlement purpose, and whether the canonical mapping is cut or kept.",
  },
  {
    id: "fraud_risk",
    dataClass: "Fraud, abuse, risk and security audit",
    targets: ["hub_user_risk_flags", "identity_merge_incidents", "hub_profile_country_audit"],
    action: "pseudonymize",
    retention: null,
    notes: "TBD: period and restricted-access roles. Retaining this is the normal outcome, not an exception.",
  },
  {
    id: "referrals",
    dataClass: "Referral relationships",
    targets: ["hub_referrals", "hub_referral_codes", "referral_reward_jobs"],
    action: "pseudonymize",
    retention: null,
    notes: "TBD: must not expose the deleted member to either side of the referral.",
  },
  {
    id: "skill_game_prizes",
    dataClass: "Skill-game leaderboard prize deliveries",
    targets: ["skill_game_leaderboard_prize_deliveries"],
    action: "pseudonymize",
    retention: null,
    notes:
      "TBD. Found by the static foreign-key check, not by hand: " +
      "skill_game_leaderboard_prize_deliveries.hub_user_id references auth.users, so the row has " +
      "to be resolved before the Auth user can be deleted. Treat as prize/settlement evidence " +
      "unless finance says otherwise.",
  },
  {
    id: "notification_history",
    dataClass: "Notification history",
    targets: ["notification_outbox"],
    action: "delete",
    retention: null,
    notes: "TBD: whether any row is transaction evidence. Delivery addresses are never retained.",
  },
  {
    id: "analytics",
    dataClass: "Analytics/crash data",
    targets: ["processor:google-analytics", "processor:crash-reporting"],
    action: "processor",
    retention: null,
    notes: "TBD: processor list, deletion API per processor, and SDK identifiers in the binary.",
  },
  {
    id: "onchain",
    dataClass: "Celo transactions and wallet addresses",
    targets: ["chain:celo"],
    action: "immutable",
    retention: null,
    notes: "TBD: the disclosure wording only. Akiba cannot delete or mutate these records.",
  },
  {
    id: "deletion_record",
    dataClass: "Deletion request/events",
    targets: ["account_deletion_requests", "account_deletion_events"],
    action: "pseudonymize",
    retention: null,
    notes: "TBD: evidence period for proving a request was made and honoured.",
  },
];

export type InventoryApproval =
  | { approved: true }
  | { approved: false; unapprovedRowIds: string[] };

/** Rows still waiting on the data-protection owner. */
export function unapprovedInventoryRows(): InventoryRow[] {
  return DELETION_INVENTORY.filter((row) => row.retention === null);
}

export function reviewInventory(): InventoryApproval {
  const pending = unapprovedInventoryRows();
  return pending.length === 0
    ? { approved: true }
    : { approved: false, unapprovedRowIds: pending.map((row) => row.id) };
}

export class InventoryNotApprovedError extends Error {
  constructor(readonly unapprovedRowIds: string[]) {
    super(
      `Account-deletion processing is blocked: ${unapprovedRowIds.length} retention inventory row(s) are unapproved`,
    );
    this.name = "InventoryNotApprovedError";
  }
}

/**
 * Guard the worker must call before touching member data. §9: "No production
 * feature flag may enable deletion processing while an inventory row is TBD."
 */
export function assertInventoryApproved(): void {
  const review = reviewInventory();
  if (!review.approved) {
    throw new InventoryNotApprovedError(review.unapprovedRowIds);
  }
}

/** Inventory rows the worker executes itself, in processing order. */
export function executableInventoryRows(): InventoryRow[] {
  return DELETION_INVENTORY.filter(
    (row) => row.action !== "immutable" && row.action !== "processor",
  );
}
