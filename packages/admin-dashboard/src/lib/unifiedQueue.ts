// Unified Queue data layer (spec §10.2). Aggregates real rows from the 7
// queue sources into one normalized shape — no new cross-domain mutation
// API, no fabricated assignment/resolution state: a field is only populated
// when the source table genuinely has it. Each item links back to its own
// specialist page for the actual action (spec: "consolidate fragmented
// queues without removing their specialist detail pages").

import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";
import type { AdminRole } from "@/types";
import { COMPLETED_ATTEMPT_STATUSES, OPEN_ATTEMPT_STATUSES } from "@/lib/subscriptionPayments";

export type QueueSourceId =
  | "incidents"
  | "profile_reviews"
  | "discovery_items"
  | "discovery_photos"
  | "referral_reviews"
  | "subscription_payments"
  | "flagged_skill_games";

export const QUEUE_SOURCE_LABELS: Record<QueueSourceId, string> = {
  incidents: "Operational incident",
  profile_reviews: "Merchant profile review",
  discovery_items: "Discovery item",
  discovery_photos: "Discovery photo",
  referral_reviews: "Referral reward review",
  subscription_payments: "Subscription payment",
  flagged_skill_games: "Flagged skill-game session",
};

export interface QueueItem {
  key: string;
  source: QueueSourceId;
  title: string;
  subtitle?: string;
  statusLabel: string;
  href?: string;
  createdAt: string;
  ageMinutes: number;
  state: "open" | "resolved";
  /** Only set when the source table has a genuine assignee/claim field — never fabricated. */
  assigneeId?: string | null;
  urgent: boolean;
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

const SLA_BREACH_MINUTES = 60;

async function incidentItems(): Promise<QueueItem[]> {
  const { data } = await supabase
    .from("ops_incidents")
    .select("id, title, description, target_type, target_id, status, assigned_to, created_at")
    .not("incident_type", "in", '("stale_order","unresolved_payout")')
    .order("created_at", { ascending: true })
    .limit(150);

  return (data ?? []).map((row) => ({
    key: `incidents:${row.id}`,
    source: "incidents" as const,
    title: row.title,
    subtitle: row.description ?? (row.target_type ? `${row.target_type}: ${row.target_id}` : undefined),
    statusLabel: row.status.replace(/_/g, " "),
    href: undefined,
    createdAt: row.created_at,
    ageMinutes: minutesAgo(row.created_at),
    state: row.status === "open" || row.status === "in_progress" ? "open" : "resolved",
    assigneeId: row.assigned_to,
    urgent: row.status === "open" || row.status === "in_progress",
  }));
}

async function profileReviewItems(): Promise<QueueItem[]> {
  const { data } = await supabase
    .from("partner_settings")
    .select("partner_id, directory_status, directory_submitted_at, directory_updated_at, partners(name)")
    .neq("directory_status", "draft")
    .order("directory_submitted_at", { ascending: true })
    .limit(150);

  return (data ?? []).map((row) => {
    const partner = row.partners as unknown as { name: string | null } | null;
    const at = row.directory_submitted_at ?? row.directory_updated_at;
    return {
      key: `profile_reviews:${row.partner_id}`,
      source: "profile_reviews" as const,
      title: partner?.name ?? row.partner_id,
      subtitle: row.directory_status.replace(/_/g, " "),
      statusLabel: row.directory_status.replace(/_/g, " "),
      href: `/directory-reviews/${row.partner_id}`,
      createdAt: at ?? new Date().toISOString(),
      ageMinutes: at ? minutesAgo(at) : 0,
      state: row.directory_status === "pending_review" ? "open" : "resolved",
      urgent: false,
    };
  });
}

async function discoveryItemItems(): Promise<QueueItem[]> {
  const { data } = await supabase
    .from("merchant_discovery_items")
    .select("id, canonical_name, category, status, first_seen_at, partners(name)")
    .in("status", ["candidate", "qualified", "merged", "suppressed"])
    .order("first_seen_at", { ascending: true })
    .limit(150);

  return (data ?? []).map((row) => {
    const partner = row.partners as unknown as { name: string | null } | null;
    return {
      key: `discovery_items:${row.id}`,
      source: "discovery_items" as const,
      title: row.canonical_name,
      subtitle: [partner?.name, row.category].filter(Boolean).join(" · ") || undefined,
      statusLabel: row.status,
      href: "/discovery-items",
      createdAt: row.first_seen_at,
      ageMinutes: minutesAgo(row.first_seen_at),
      state: row.status === "candidate" ? "open" : "resolved",
      urgent: false,
    };
  });
}

async function discoveryPhotoItems(): Promise<QueueItem[]> {
  const { data } = await supabase
    .from("merchant_visit_photos")
    .select("id, moderation_status, submitted_at, approved_at, partners(name)")
    .in("moderation_status", ["pending", "approved", "rejected"])
    .order("submitted_at", { ascending: true })
    .limit(150);

  return (data ?? []).map((row) => {
    const partner = row.partners as unknown as { name: string | null } | null;
    const at = row.submitted_at ?? row.approved_at ?? new Date().toISOString();
    return {
      key: `discovery_photos:${row.id}`,
      source: "discovery_photos" as const,
      title: partner?.name ?? "Photo submission",
      subtitle: "Merchant visit photo",
      statusLabel: row.moderation_status,
      href: "/discovery-photos",
      createdAt: at,
      ageMinutes: minutesAgo(at),
      state: row.moderation_status === "pending" ? "open" : "resolved",
      urgent: false,
    };
  });
}

async function referralReviewItems(): Promise<QueueItem[]> {
  const { data } = await supabase
    .from("referral_reward_jobs")
    .select("id, milestone, amount_miles, status, created_at")
    .in("status", ["manual_review", "released", "voided", "reversed"])
    .order("created_at", { ascending: true })
    .limit(150);

  return (data ?? []).map((row) => ({
    key: `referral_reviews:${row.id}`,
    source: "referral_reviews" as const,
    title: `Reward job · ${row.milestone}`,
    subtitle: `${row.amount_miles} miles`,
    statusLabel: row.status.replace(/_/g, " "),
    href: "/referrals/queue",
    createdAt: row.created_at,
    ageMinutes: minutesAgo(row.created_at),
    state: row.status === "manual_review" ? "open" : "resolved",
    urgent: false,
  }));
}

async function subscriptionPaymentItems(): Promise<QueueItem[]> {
  const { data } = await supabase
    .from("v_admin_subscription_payment_queue")
    .select("payment_attempt_id, merchant_name, partner_id, invoice_number, status, reviewer_admin_user_id, submitted_at, decided_at")
    .in("status", [...OPEN_ATTEMPT_STATUSES, ...COMPLETED_ATTEMPT_STATUSES])
    .order("submitted_at", { ascending: true })
    .limit(150);

  return (data ?? []).map((row) => {
    const isOpen = (OPEN_ATTEMPT_STATUSES as readonly string[]).includes(row.status);
    const at = row.submitted_at;
    const age = minutesAgo(at);
    return {
      key: `subscription_payments:${row.payment_attempt_id}`,
      source: "subscription_payments" as const,
      title: row.merchant_name ?? row.partner_id,
      subtitle: row.invoice_number ?? undefined,
      statusLabel: row.status.replace(/_/g, " "),
      href: `/finance/subscriptions/${row.payment_attempt_id}`,
      createdAt: at,
      ageMinutes: age,
      state: isOpen ? "open" : "resolved",
      assigneeId: row.reviewer_admin_user_id,
      urgent: isOpen && age >= SLA_BREACH_MINUTES,
    };
  });
}

async function flaggedSkillGameItems(): Promise<QueueItem[]> {
  const { data } = await supabase
    .from("skill_game_sessions")
    .select("session_id, wallet_address, anti_abuse_flags, created_at")
    .not("anti_abuse_flags", "is", null)
    .order("created_at", { ascending: true })
    .limit(300);

  const flagged = (data ?? []).filter(
    (r) => Array.isArray(r.anti_abuse_flags) && r.anti_abuse_flags.length > 0,
  );

  return flagged.slice(0, 150).map((row) => ({
    key: `flagged_skill_games:${row.session_id}`,
    source: "flagged_skill_games" as const,
    title: `${row.wallet_address.slice(0, 6)}…${row.wallet_address.slice(-4)}`,
    subtitle: (row.anti_abuse_flags as string[]).join(", "),
    statusLabel: "flagged",
    href: "/games/skill-games",
    createdAt: row.created_at,
    ageMinutes: minutesAgo(row.created_at),
    state: "open" as const,
    urgent: false,
  }));
}

const SOURCE_PERMISSIONS: Record<QueueSourceId, string> = {
  incidents: "incidents.read",
  profile_reviews: "merchants.read",
  discovery_items: "discovery.read",
  discovery_photos: "discovery.read",
  referral_reviews: "referrals.read",
  subscription_payments: "finance.read",
  flagged_skill_games: "orders.read",
};

export async function getQueueItems(role: AdminRole): Promise<QueueItem[]> {
  const fetchers: Array<[QueueSourceId, () => Promise<QueueItem[]>]> = [
    ["incidents", incidentItems],
    ["profile_reviews", profileReviewItems],
    ["discovery_items", discoveryItemItems],
    ["discovery_photos", discoveryPhotoItems],
    ["referral_reviews", referralReviewItems],
    ["subscription_payments", subscriptionPaymentItems],
    ["flagged_skill_games", flaggedSkillGameItems],
  ];

  const permitted = fetchers.filter(([id]) => hasPermission(role, SOURCE_PERMISSIONS[id]));
  const results = await Promise.all(permitted.map(([, fetch]) => fetch()));
  return results.flat();
}
