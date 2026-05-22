// ── Admin roles ───────────────────────────────────────────────────────────────

export type AdminRole =
  | "super_admin"
  | "ops_admin"
  | "finance_admin"
  | "insights_admin"
  | "readonly";

export const ADMIN_ROLES: AdminRole[] = [
  "super_admin",
  "ops_admin",
  "finance_admin",
  "insights_admin",
  "readonly",
];

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: "Super Admin",
  ops_admin: "Ops Admin",
  finance_admin: "Finance Admin",
  insights_admin: "Insights Admin",
  readonly: "Read-only",
};

// ── Session ───────────────────────────────────────────────────────────────────

export interface AdminSessionData {
  adminUserId: string;
  email: string;
  name: string | null;
  role: AdminRole;
  mustChangePassword?: boolean;
  issuedAt: number;
  openAccess?: boolean;
}

// ── Admin user ────────────────────────────────────────────────────────────────

export interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: AdminRole;
  is_active: boolean;
  must_change_password: boolean;
  created_by: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export interface AdminAuditLog {
  id: string;
  admin_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  created_at: string;
  admin_users?: { name: string | null; email: string } | null;
}

// ── Polls ─────────────────────────────────────────────────────────────────────

export type PollStatus = "draft" | "live" | "closed" | "verified";
export type QuestionType = "single_choice" | "multi_choice" | "rating" | "free_text";

export interface Poll {
  id: string;
  title: string;
  description: string | null;
  status: PollStatus;
  target_segment: Record<string, unknown> | null;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // aggregates joined in queries
  response_count?: number;
  complete_count?: number;
}

export interface PollQuestion {
  id: string;
  poll_id: string;
  question_text: string;
  question_type: QuestionType;
  options: string[] | null;
  sort_order: number;
  required: boolean;
}

export interface PollResponse {
  id: string;
  poll_id: string;
  user_address: string;
  wallet_age_days: number | null;
  city: string | null;
  merchant_id: string | null;
  started_at: string;
  completed_at: string | null;
  is_complete: boolean;
  quality_flag: string | null;
}

export interface PollResponseAnswer {
  id: string;
  response_id: string;
  question_id: string;
  selected_options: string[] | null;
  rating_value: number | null;
  free_text: string | null;
}

// ── Verified insights ─────────────────────────────────────────────────────────

export interface VerifiedInsight {
  id: string;
  poll_id: string;
  summary: string;
  key_findings: string[] | null;
  reviewed_by: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsightReviewNote {
  id: string;
  poll_id: string;
  admin_user_id: string | null;
  note: string;
  created_at: string;
  admin_users?: { name: string | null; email: string } | null;
}

// ── Risk flags ────────────────────────────────────────────────────────────────

export type RiskFlagType =
  | "suspicious_activity"
  | "blacklisted"
  | "rewards_disabled"
  | "manual_review";

export interface WalletRiskFlag {
  id: string;
  user_address: string;
  flag_type: RiskFlagType;
  reason: string | null;
  flagged_by: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  is_active: boolean;
  created_at: string;
}

// ── Merchant admin notes ──────────────────────────────────────────────────────

export interface MerchantAdminNote {
  id: string;
  partner_id: string;
  admin_user_id: string | null;
  note: string;
  created_at: string;
  admin_users?: { name: string | null; email: string } | null;
}

// ── Overview stats ────────────────────────────────────────────────────────────

export interface OverviewStats {
  total_users: number;
  active_wallets: number;
  miles_minted: number;
  miles_burned: number;
  miles_outstanding: number;
  total_merchants: number;
  active_orders: number;
  vouchers_issued: number;
  vouchers_redeemed: number;
  poll_response_count: number;
  open_incidents: number;
}

// ── Ops incidents ─────────────────────────────────────────────────────────────

export type IncidentStatus = "open" | "in_progress" | "resolved" | "wont_fix";
export type IncidentType =
  | "stale_order"
  | "failed_randomness"
  | "unresolved_payout"
  | "suspicious_redemption"
  | "manual_review"
  | "other";

export interface OpsIncident {
  id: string;
  incident_type: IncidentType;
  status: IncidentStatus;
  title: string;
  description: string | null;
  target_type: string | null;
  target_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

// ── Permission helpers ────────────────────────────────────────────────────────

export const ROLE_PERMISSIONS: Record<AdminRole, Set<string>> = {
  super_admin: new Set(["*"]),
  ops_admin: new Set([
    "merchants.read", "merchants.write",
    "orders.read", "orders.write",
    "users.read",
    "audit.read",
    "incidents.read", "incidents.write",
  ]),
  finance_admin: new Set([
    "finance.read", "finance.write",
    "vouchers.read",
    "orders.read",
    "audit.read",
  ]),
  insights_admin: new Set([
    "polls.read", "polls.write",
    "insights.read", "insights.write",
    "audit.read",
  ]),
  readonly: new Set([
    "merchants.read", "orders.read", "users.read",
    "finance.read", "polls.read", "insights.read",
    "vouchers.read", "audit.read",
  ]),
};

export function hasPermission(role: AdminRole, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  return perms.has("*") || perms.has(permission);
}
