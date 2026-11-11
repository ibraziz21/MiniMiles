/**
 * Verified-discovery earning ingestion
 * (verified-discovery-acquisition-v1-spec.md §8.1, §11.1).
 *
 * One idempotent entry point called from both authoritative credit paths —
 * reward-release.ts (Hub order checkout) and
 * /api/internal/miles-credited (Platform-sourced merchant_scan/
 * merchant_purchase) — right alongside produceMilesEarnedNotification(),
 * never instead of it. This function's outcome must never affect the
 * caller's response: recording verified-discovery evidence and notifying
 * the member about Miles are independent concerns (§8.1 — "a contribution
 * failure must never fail or roll back the Miles credit").
 *
 * `resolvedChannel` is decided by the caller, not trusted from the event
 * body: a merchant_scan proves physical presence by construction (always
 * "in_store"), while a merchant_purchase channel comes from the producer's
 * own authoritative claim (already Bearer-authenticated) or defaults to
 * "unknown" until Akiba-Platform supplies it (§21.4 — an external
 * dependency, not something this repo can invent).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { MilesCreditedEvent } from "@/lib/akiba/milesEarnedNotification";
import { isDiscoveryContributionsEnabledFor } from "@/lib/akiba/discoveryContributionsRollout";
import { queueContributionRequestNotification } from "@/lib/akiba/contributionRequestNotification";

export type EarningChannel = "in_store" | "online" | "unknown";

export async function recordVerifiedEarningForDiscovery(
  event: MilesCreditedEvent,
  resolvedChannel: EarningChannel,
): Promise<void> {
  try {
    const admin = createAdminClient();

    const { data: eventRow, error: insertError } = await admin
      .from("verified_earning_events")
      .upsert(
        {
          event_id: event.eventId,
          hub_user_id: event.hubUserId,
          canonical_id: event.canonicalId ?? null,
          partner_id: event.merchantId,
          source: event.source,
          channel: resolvedChannel,
          occurred_at: event.occurredAt,
          purchase_event_id: event.purchaseEventId ?? null,
          branch_id: event.branchId ?? null,
          paid_amount_minor: event.paidAmountMinor ?? null,
          currency: event.currency ?? null,
          source_item_ref: event.sourceItemRef ?? null,
        },
        { onConflict: "event_id", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle();

    if (insertError) {
      console.error("[discovery-ingestion] verified_earning_events upsert failed:", insertError.message);
      return;
    }

    if (resolvedChannel !== "in_store") return;
    if (!isDiscoveryContributionsEnabledFor(event.hubUserId)) return;

    // ignoreDuplicates means a retried/duplicate eventId returns no row —
    // look it up so a retry can still (idempotently) attempt request
    // creation rather than silently no-op'ing on every retry after the
    // first.
    const earningEventId =
      eventRow?.id ??
      (
        await admin
          .from("verified_earning_events")
          .select("id")
          .eq("event_id", event.eventId)
          .maybeSingle()
      ).data?.id;

    if (!earningEventId) {
      console.error("[discovery-ingestion] could not resolve earning_event_id for", event.eventId);
      return;
    }

    // A callback may have arrived before the merchant redemption proof.
    // Recovery can promote unknown evidence, but cannot rewrite online
    // evidence or change the member/merchant attached to the original event.
    const { error: channelError } = await admin
      .from("verified_earning_events")
      .update({ channel: "in_store" })
      .eq("id", earningEventId)
      .eq("hub_user_id", event.hubUserId)
      .eq("partner_id", event.merchantId)
      .eq("channel", "unknown");
    if (channelError) {
      console.error("[discovery-ingestion] channel recovery failed:", channelError.message);
      return;
    }

    const { data: created, error: requestError } = await admin.rpc("create_discovery_contribution_request", {
      p_earning_event_id: earningEventId,
      p_hub_user_id: event.hubUserId,
      p_partner_id: event.merchantId,
    });
    if (requestError) {
      console.error("[discovery-ingestion] create_discovery_contribution_request failed:", requestError.message);
      return;
    }

    // Only a request this call actually opened gets a push. `already_exists`
    // is a retry of the same visit, and the refusals (cooldown, open request,
    // contributions off for the merchant) are not asks at all.
    const result = (Array.isArray(created) ? created[0] : created) as
      | { ok?: boolean; request_id?: string | null; reason?: string | null }
      | null;
    if (result?.ok && result.request_id && result.reason !== "already_exists") {
      await queueContributionRequestNotification({
        requestId: result.request_id,
        hubUserId: event.hubUserId,
        merchantId: event.merchantId,
        merchantName: event.merchantName,
      });
    }
  } catch (err) {
    console.error("[discovery-ingestion] recordVerifiedEarningForDiscovery failed:", err);
  }
}
