/**
 * "How was <merchant>?" push for a newly opened discovery contribution
 * request (verified-discovery-acquisition-v1-spec.md §8).
 *
 * Called by recordVerifiedEarningForDiscovery only when
 * create_discovery_contribution_request actually opened a request — never for
 * `already_exists`, a cooldown, or a merchant that doesn't take
 * recommendations — so one verified visit produces at most one ask.
 *
 * Migration 123 holds the push job back 45 minutes, and the dispatcher
 * re-checks the request is still open before sending
 * (contributionRequestStillOpen), so a member who recommends the place from
 * the store page in the meantime is never asked twice.
 *
 * Best effort, like the ingestion around it: a failure here is logged and
 * never affects the Miles credit or the request itself.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

export async function queueContributionRequestNotification(input: {
  requestId: string;
  hubUserId: string;
  merchantId: string;
  merchantName: string;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: partner, error: partnerError } = await admin
      .from("partners")
      .select("slug, name")
      .eq("id", input.merchantId)
      .maybeSingle();
    if (partnerError) {
      console.error("[contribution-request-push] merchant lookup failed:", partnerError.message);
      return;
    }

    const slug = typeof partner?.slug === "string" ? partner.slug.trim() : "";
    const merchantName = (partner?.name ?? input.merchantName ?? "").trim().slice(0, 60) || "this place";

    const { error } = await admin.from("notification_outbox").upsert(
      {
        user_ref: input.hubUserId,
        hub_user_id: input.hubUserId,
        template: "contribution_requested",
        category: "earnings",
        // The store page opens on its Verified tab, where the recommendation
        // form lives. Without a slug the merchant directory is the nearest
        // useful place rather than a dead link.
        deep_link: slug ? `/merchants/${slug}?tab=verified` : "/merchants",
        dedupe_key: `notif:contribution-request:${input.requestId}`,
        metadata: { requestId: input.requestId, merchantId: input.merchantId, merchantName },
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    if (error) {
      console.error("[contribution-request-push] notification_outbox upsert failed:", error.message);
    }
  } catch (err) {
    console.error("[contribution-request-push] failed:", err);
  }
}

/** Send-time guard: only ask while the request can still be answered. */
export async function contributionRequestStillOpen(
  admin: SupabaseClient,
  requestId: unknown,
): Promise<boolean> {
  if (typeof requestId !== "string" || !requestId) return false;
  const { data, error } = await admin
    .from("discovery_contribution_requests")
    .select("state, expires_at")
    .eq("id", requestId)
    .maybeSingle();
  // A lookup failure sends rather than suppresses: the request was open when
  // the push was queued, and one extra ask is better than a silent drop.
  if (error) return true;
  if (!data || data.state !== "open") return false;
  return !data.expires_at || Date.parse(data.expires_at) > Date.now();
}
