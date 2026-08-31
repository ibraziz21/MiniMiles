// Shared contract for the MiniMiles Admin subscription payment review surface.
//
// Akiba Platform owns the underlying tables, views, evidence bucket, and guarded
// transition RPCs. This module only names that contract and provides the
// presentation/validation helpers used by the admin-dashboard routes and screens.
// MiniMiles never writes shared financial rows directly — every mutation goes
// through one of the RPCs below.

// ── Akiba-owned read projections ─────────────────────────────────────────────

export const SUBSCRIPTION_PAYMENT_VIEWS = {
  /** Oldest-first review queue + completed history (filter by status). */
  queue: "v_admin_subscription_payment_queue",
  /** Single attempt with invoice, merchant, subscription, and submission JSON. */
  detail: "v_admin_subscription_payment_detail",
  /** Prior submitted/rejected attempts for the same invoice. */
  priorAttempts: "v_admin_subscription_payment_prior_attempts",
  /** Other uses of a normalized provider reference (no cross-merchant PII). */
  referenceUses: "v_admin_subscription_payment_reference_uses",
  /** Rendered receipt payload for a paid invoice. */
  receipt: "v_admin_subscription_receipt",
} as const;

// ── Akiba-owned guarded transition RPCs ──────────────────────────────────────
//
// Signatures (Akiba migrations 092 + 096):
//   start_subscription_payment_review(p_attempt_id, p_admin_id, p_expected_version)
//   take_over_subscription_payment_review(p_attempt_id, p_admin_id, p_reason, p_expected_version)
//   confirm_subscription_payment(p_attempt_id, p_admin_id, p_confirmed_amount,
//                                p_confirmed_reference, p_expected_version, p_allow_override)
//   reject_subscription_payment(p_attempt_id, p_admin_id, p_rejection_code,
//                               p_rejection_message, p_expected_version, p_allow_override)
//   void_reissue_subscription_invoice(p_invoice_id, p_admin_id, p_reason, p_reissue)
//
// Every RPC returns a row shaped { ok boolean, error_code text, ... }; a non-SQL
// business failure comes back as ok=false with error_code, not a thrown error.

export const SUBSCRIPTION_PAYMENT_RPCS = {
  startReview: "start_subscription_payment_review",
  takeOver: "take_over_subscription_payment_review",
  confirm: "confirm_subscription_payment",
  reject: "reject_subscription_payment",
  voidReissueInvoice: "void_reissue_subscription_invoice",
} as const;

/**
 * Reviewer id sent to Akiba RPCs. In local open-access mode `adminIdForWrite`
 * returns null; Akiba's `p_admin_id` is a UUID column, so fall back to the
 * canonical zero UUID rather than a non-UUID string.
 */
export const OPEN_ACCESS_ADMIN_ID = "00000000-0000-0000-0000-000000000000";

/** RPC `error_code` → merchant/finance-safe message. */
export const RPC_ERROR_MESSAGES: Record<string, string> = {
  ATTEMPT_NOT_FOUND: "Payment attempt not found.",
  ALREADY_DECIDED: "This attempt has already been decided.",
  ALREADY_CONFIRMED: "This attempt has already been confirmed.",
  ALREADY_REJECTED: "This attempt has already been rejected.",
  ALREADY_CLAIMED: "Another reviewer has already claimed this attempt.",
  NOT_UNDER_REVIEW: "This attempt is not currently under review.",
  CLAIMED_BY_ANOTHER_ADMIN: "This attempt is claimed by another reviewer.",
  CLAIM_NOT_STALE: "The current claim is not stale enough to take over yet.",
  REASON_REQUIRED: "A reason is required.",
  VERSION_CONFLICT: "This record changed since you loaded it. Reload and retry.",
  INVALID_INVOICE_STATE: "The invoice is no longer in a payable state.",
  AMOUNT_MISMATCH: "The confirmed amount must exactly equal the invoice balance.",
  DUPLICATE_REFERENCE: "That provider reference has already confirmed a payment.",
  INVOICE_NOT_FOUND: "Invoice not found.",
  ATTEMPT_PENDING: "Reject or resolve the open payment attempt before voiding this invoice.",
};

/** HTTP status for an RPC `error_code` — everything conflict-ish is 409. */
export function statusForRpcError(code: string | null | undefined): number {
  if (code === "ATTEMPT_NOT_FOUND" || code === "INVOICE_NOT_FOUND") return 404;
  return 409;
}

/**
 * Roles allowed to start, take over, confirm, or reject a review. Mutation
 * routes still call `requireAdminSession("finance.write")` first; this is the
 * additional explicit restriction the spec requires.
 */
export const DECISION_ROLES = new Set(["super_admin", "finance_admin"]);

// ── Enumerations ────────────────────────────────────────────────────────────

export type AttemptStatus =
  | "submitted"
  | "under_review"
  | "confirmed"
  | "rejected";

export const OPEN_ATTEMPT_STATUSES: AttemptStatus[] = ["submitted", "under_review"];
export const COMPLETED_ATTEMPT_STATUSES: AttemptStatus[] = ["confirmed", "rejected"];

// Mirrors the CHECK on subscription_payment_attempts.method (Akiba 089).
export const PAYMENT_METHODS = ["bank_transfer", "mpesa_paybill", "ncba_mobile", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank_transfer: "Bank transfer",
  mpesa_paybill: "M-Pesa paybill",
  ncba_mobile: "NCBA mobile / USSD",
  other: "Other",
};

export const REJECTION_CODES = [
  "funds_not_found",
  "amount_mismatch",
  "duplicate_reference",
  "wrong_destination",
  "wrong_currency",
  "reference_mismatch",
  "unreadable_evidence",
  "invoice_not_payable",
  "other",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export const REJECTION_CODE_LABELS: Record<RejectionCode, string> = {
  funds_not_found: "Funds not found in NCBA account",
  amount_mismatch: "Amount does not match invoice balance",
  duplicate_reference: "Reference already used",
  wrong_destination: "Paid to the wrong destination",
  wrong_currency: "Currency is not KES",
  reference_mismatch: "Reference does not match records",
  unreadable_evidence: "Evidence missing or unreadable",
  invoice_not_payable: "Invoice is no longer payable",
  other: "Other (explain in the note)",
};

export const RISK_FLAG_LABELS: Record<string, string> = {
  amount_mismatch: "Amount mismatch",
  duplicate_reference_submitted: "Duplicate submitted reference",
  duplicate_reference_confirmed: "Duplicate confirmed reference",
  currency_not_kes: "Currency not KES",
  invoice_not_payable: "Invoice no longer payable",
  payment_date_out_of_window: "Payment date outside window",
  evidence_missing: "Evidence missing / unreadable",
  already_under_review: "Already being reviewed",
  merchant_invoice_mismatch: "Merchant / invoice mismatch",
};

// ── SLA helpers ─────────────────────────────────────────────────────────────

export const SLA_WARN_MINUTES = 45;
export const SLA_BREACH_MINUTES = 60;
export const STALE_REVIEW_MINUTES = 30;
export const EVIDENCE_URL_TTL_SECONDS = 300;

export type SlaState = "neutral" | "amber" | "red";

export function minutesSince(iso: string | null | undefined, now: number = Date.now()): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60000));
}

export function slaState(submittedAt: string | null | undefined, now: number = Date.now()): SlaState {
  const mins = minutesSince(submittedAt, now);
  if (mins >= SLA_BREACH_MINUTES) return "red";
  if (mins >= SLA_WARN_MINUTES) return "amber";
  return "neutral";
}

export function isStaleReview(
  reviewStartedAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!reviewStartedAt) return false;
  return minutesSince(reviewStartedAt, now) >= STALE_REVIEW_MINUTES;
}

export function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// ── Money at the API boundary ──────────────────────────────────────────────

const DECIMAL_RE = /^\d{1,12}(\.\d{1,2})?$/;

/**
 * Validates a decimal-string money amount as sent across the API boundary.
 * Returns the normalized string (always two fraction digits) or null when
 * invalid. The server never does float math on these values.
 */
export function normalizeDecimalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) return null;
  const [whole, frac = ""] = trimmed.split(".");
  return `${whole}.${(frac + "00").slice(0, 2)}`;
}

// ── Text hygiene ───────────────────────────────────────────────────────────

export const MAX_NOTE_LENGTH = 2000;
export const MAX_MERCHANT_MESSAGE_LENGTH = 500;

export function textOrNull(value: unknown, maxLength = MAX_NOTE_LENGTH): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Deterministic idempotency key for a confirm/reject decision on an attempt. */
export function decisionIdempotencyKey(
  attemptId: string,
  action: "confirm" | "reject",
): string {
  return `payment-review:${attemptId}:${action}`;
}

// ── Row shapes (best-effort typing over Akiba-owned views) ──────────────────

export interface QueueRow {
  payment_attempt_id: string;
  status: AttemptStatus;
  submitted_at: string;
  version: number;
  partner_id: string;
  merchant_name: string | null;
  invoice_id: string;
  invoice_number: string | null;
  invoice_type: string | null;
  invoice_status: string | null;
  short_payment_reference: string | null;
  plan: string | null;
  billing_term: string | null;
  expected_amount: string | null;
  submitted_amount: string | null;
  submitted_currency: string | null;
  payment_method: string | null;
  provider_reference_masked: string | null;
  payment_date: string | null;
  reviewer_admin_user_id: string | null;
  reviewer_name: string | null;
  review_started_at: string | null;
  risk_flags: string[] | null;
  has_evidence: boolean | null;
  decided_at: string | null;
  decision_reason: string | null;
  receipt_number: string | null;
}

export interface SubscriptionEffect {
  status: string;
  plan: string;
  billingPeriod: string;
  termStart: string;
  termEnd: string;
  nextRenewalAt: string;
  usagePeriodEnd: string;
}
