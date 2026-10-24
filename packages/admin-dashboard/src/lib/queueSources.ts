// Exact pending counts plus the latest available timestamp, without fetching
// every pending row or inheriting PostgREST's default row limit.
import { supabase } from "@/lib/supabase";
import { hasPermission, type AdminRole } from "@/types";
export interface QueueSourceSummary {
  id: string; label: string; href: string; count: number;
  oldestAgeMinutes: number | null; unavailable?: boolean;
}
const sources = [
  { id: "profile_reviews", label: "Merchant publishing", href: "/directory-reviews", table: "partner_settings", status: "directory_status", pending: "pending_review", date: "directory_submitted_at", permission: "merchants.read" },
  { id: "discovery_photos", label: "Image review", href: "/discovery-photos", table: "merchant_visit_photos", status: "moderation_status", pending: "pending", date: "submitted_at", permission: "discovery.read" },
  { id: "discovery_reports", label: "Report reviews", href: "/discovery-reports", table: "merchant_verified_visit_reports", status: "status", pending: "pending", date: "created_at", permission: "discovery.read" },
];
export async function getQueueSourceSummaries(role: AdminRole): Promise<QueueSourceSummary[]> {
  return Promise.all(sources.filter(source => hasPermission(role, source.permission)).map(async source => {
    const { data, count, error } = await supabase.from(source.table)
      .select(source.date, { count: "exact" }).eq(source.status, source.pending)
      .order(source.date, { ascending: true }).limit(1);
    const oldest = (data?.[0] as unknown as Record<string, string> | undefined)?.[source.date];
    return { id: source.id, label: source.label, href: source.href, count: count ?? 0,
      oldestAgeMinutes: oldest ? Math.max(0, Math.round((Date.now() - new Date(oldest).getTime()) / 60000)) : null,
      unavailable: Boolean(error) };
  }));
}
