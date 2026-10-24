export type QueueSourceId = "profile_reviews" | "discovery_photos" | "discovery_reports" | "verified_visits";
export const QUEUE_SOURCE_LABELS: Record<QueueSourceId, string> = {
  profile_reviews: "Merchant publishing",
  discovery_photos: "Image review",
  discovery_reports: "Report reviews",
  verified_visits: "Verified visits",
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

