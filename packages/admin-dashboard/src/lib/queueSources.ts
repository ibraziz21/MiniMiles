// Lightweight cross-source aggregation for the 7 queue types the spec's
// Unified Queue will eventually cover (§10.2). Per spec: "The first
// implementation may aggregate links/counts from existing sources instead of
// creating a new cross-domain mutation API" — this is exactly that: counts
// and oldest-pending-age per source, read-only, linking to each source's own
// existing page. No new mutation surface, no fabricated assignment/resolution
// state. Used by Home's urgent-attention card and pending-work preview now;
// reusable as-is when the full Unified Queue page is built.

import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/types";
import type { AdminRole } from "@/types";

export interface QueueSourceSummary {
  id: string;
  label: string;
  href: string;
  count: number;
  oldestAgeMinutes: number | null;
}

function minutesAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

async function incidentsSummary(): Promise<QueueSourceSummary> {
  const { data } = await supabase
    .from("ops_incidents")
    .select("created_at")
    .in("status", ["open", "in_progress"])
    .not("incident_type", "in", '("stale_order","unresolved_payout")')
    .order("created_at", { ascending: true });
  const rows = data ?? [];
  return {
    id: "incidents",
    label: "Operational incidents",
    href: "/ops-queue",
    count: rows.length,
    oldestAgeMinutes: minutesAgo(rows[0]?.created_at),
  };
}

async function profileReviewsSummary(): Promise<QueueSourceSummary> {
  const { data } = await supabase
    .from("partner_settings")
    .select("directory_submitted_at")
    .eq("directory_status", "pending_review")
    .order("directory_submitted_at", { ascending: true });
  const rows = data ?? [];
  return {
    id: "profile_reviews",
    label: "Merchant profile reviews",
    href: "/directory-reviews",
    count: rows.length,
    oldestAgeMinutes: minutesAgo(rows[0]?.directory_submitted_at),
  };
}

async function discoveryItemsSummary(): Promise<QueueSourceSummary> {
  const { data } = await supabase
    .from("merchant_discovery_items")
    .select("first_seen_at")
    .eq("status", "candidate")
    .order("first_seen_at", { ascending: true });
  const rows = data ?? [];
  return {
    id: "discovery_items",
    label: "Discovery items",
    href: "/discovery-items",
    count: rows.length,
    oldestAgeMinutes: minutesAgo(rows[0]?.first_seen_at),
  };
}

async function discoveryPhotosSummary(): Promise<QueueSourceSummary> {
  const { data } = await supabase
    .from("merchant_visit_photos")
    .select("submitted_at")
    .eq("moderation_status", "pending")
    .order("submitted_at", { ascending: true });
  const rows = data ?? [];
  return {
    id: "discovery_photos",
    label: "Discovery photos",
    href: "/discovery-photos",
    count: rows.length,
    oldestAgeMinutes: minutesAgo(rows[0]?.submitted_at),
  };
}

async function referralReviewsSummary(): Promise<QueueSourceSummary> {
  const { data } = await supabase
    .from("referral_reward_jobs")
    .select("created_at")
    .eq("status", "manual_review")
    .order("created_at", { ascending: true });
  const rows = data ?? [];
  return {
    id: "referral_reviews",
    label: "Referral reward reviews",
    href: "/referrals/queue",
    count: rows.length,
    oldestAgeMinutes: minutesAgo(rows[0]?.created_at),
  };
}

async function subscriptionPaymentsSummary(): Promise<QueueSourceSummary> {
  const { data } = await supabase
    .from("v_admin_subscription_payment_queue")
    .select("submitted_at")
    .in("status", ["submitted", "under_review"])
    .order("submitted_at", { ascending: true });
  const rows = data ?? [];
  return {
    id: "subscription_payments",
    label: "Subscription payments",
    href: "/finance/subscriptions",
    count: rows.length,
    oldestAgeMinutes: minutesAgo(rows[0]?.submitted_at),
  };
}

async function flaggedSkillGamesSummary(): Promise<QueueSourceSummary> {
  const { data } = await supabase
    .from("skill_game_sessions")
    .select("id, created_at, anti_abuse_flags")
    .not("anti_abuse_flags", "is", null)
    .order("created_at", { ascending: true })
    .limit(500);
  const rows = (data ?? []).filter(
    (r) => Array.isArray(r.anti_abuse_flags) && r.anti_abuse_flags.length > 0,
  );
  return {
    id: "flagged_skill_games",
    label: "Flagged skill-game sessions",
    href: "/games/skill-games",
    count: rows.length,
    oldestAgeMinutes: minutesAgo(rows[0]?.created_at),
  };
}

const SOURCE_PERMISSIONS: Record<string, string> = {
  incidents: "incidents.read",
  profile_reviews: "merchants.read",
  discovery_items: "discovery.read",
  discovery_photos: "discovery.read",
  referral_reviews: "referrals.read",
  subscription_payments: "finance.read",
  flagged_skill_games: "orders.read",
};

/** Fetches every source the role is permitted to see. Never fabricates a count for a source the caller can't read. */
export async function getQueueSourceSummaries(role: AdminRole): Promise<QueueSourceSummary[]> {
  const fetchers: Array<[string, () => Promise<QueueSourceSummary>]> = [
    ["incidents", incidentsSummary],
    ["profile_reviews", profileReviewsSummary],
    ["discovery_items", discoveryItemsSummary],
    ["discovery_photos", discoveryPhotosSummary],
    ["referral_reviews", referralReviewsSummary],
    ["subscription_payments", subscriptionPaymentsSummary],
    ["flagged_skill_games", flaggedSkillGamesSummary],
  ];

  const permitted = fetchers.filter(([id]) => hasPermission(role, SOURCE_PERMISSIONS[id]));
  const results = await Promise.all(permitted.map(([, fetch]) => fetch()));
  return results;
}
