// Current review sources. Existing specialist pages own all moderation actions.
import { supabase } from "@/lib/supabase";
import { hasPermission, type AdminRole } from "@/types";

import type { QueueItem, QueueSourceId } from "@/lib/queueTypes";

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}



async function profileReviewItems(): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from("partner_settings")
    .select("partner_id, directory_status, directory_submitted_at, directory_updated_at, partners(name)")
    .eq("directory_status", "pending_review")
    .order("directory_submitted_at", { ascending: true })
    .limit(150);

  if (error) throw new Error("Merchant publishing could not be loaded.");
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

async function discoveryPhotoItems(): Promise<QueueItem[]> {
  const { data, error } = await supabase
    .from("merchant_visit_photos")
    .select("id, moderation_status, submitted_at, approved_at, partners(name)")
    .eq("moderation_status", "pending")
    .order("submitted_at", { ascending: true })
    .limit(150);

  if (error) throw new Error("Image review could not be loaded.");
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


async function reportItems(): Promise<QueueItem[]> {
  const { data, error } = await supabase.from("merchant_verified_visit_reports")
    .select("id, contribution_id, reason_code, status, created_at")
    .eq("status", "pending").order("created_at").limit(150);
  if (error) throw new Error("Report reviews could not be loaded.");
  return (data ?? []).map(row => ({
    key: `discovery_reports:${row.id}`, source: "discovery_reports",
    title: row.reason_code.replaceAll("_", " "), subtitle: `Visit ${row.contribution_id}`,
    statusLabel: row.status, href: "/discovery-reports", createdAt: row.created_at,
    ageMinutes: minutesAgo(row.created_at), state: "open", urgent: false,
  }));
}

async function verifiedVisitItems(): Promise<QueueItem[]> {
  const { data, error } = await supabase.from("merchant_discovery_contributions")
    .select("id, submitted_at, would_recommend, partners(name)")
    .is("withdrawn_at", null).is("suppressed_at", null)
    .order("submitted_at", { ascending: false }).limit(150);
  if (error) throw new Error("Verified visits could not be loaded.");
  return (data ?? []).map(row => ({
    key: `verified_visits:${row.id}`, source: "verified_visits",
    title: (row.partners as unknown as { name: string } | null)?.name ?? "Verified merchant visit",
    subtitle: "Automatically verified visit", statusLabel: "verified", href: `/verified-visits?visit=${row.id}`,
    createdAt: row.submitted_at, ageMinutes: minutesAgo(row.submitted_at),
    state: "resolved", urgent: false,
  }));
}

const SOURCE_PERMISSIONS: Record<QueueSourceId, string> = {
  profile_reviews: "merchants.read", discovery_photos: "discovery.read",
  discovery_reports: "discovery.read", verified_visits: "discovery.read",
};
export async function getQueueItems(role: AdminRole): Promise<QueueItem[]> {
  const fetchers: Array<[QueueSourceId, () => Promise<QueueItem[]>]> = [
    ["profile_reviews", profileReviewItems], ["discovery_photos", discoveryPhotoItems],
    ["discovery_reports", reportItems], ["verified_visits", verifiedVisitItems],
  ];
  const results = await Promise.all(fetchers.filter(([id]) => hasPermission(role, SOURCE_PERMISSIONS[id])).map(([, fetch]) => fetch()));
  return results.flat();
}
