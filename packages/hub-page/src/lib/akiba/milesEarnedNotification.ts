/**
 * Shared earned-Miles notification producer
 * (akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §6.2-§6.4).
 *
 * One idempotent entry point for both callers described by the spec:
 *  - Hub orders: reward-release.ts calls this right after a confirmed
 *    releaseRewardJob() release (§6.2 "releaseRewardJob() already receives
 *    the authoritative rewardIssued and milesAwarded response").
 *  - Platform-sourced merchant-scan credits: POST /api/internal/miles-credited
 *    calls this after validating the MilesCreditedEvent contract.
 *
 * Never notifies before the credit is authoritative and committed — callers
 * are responsible for only invoking this after that fact (§6.1). This
 * function itself only decides *whether a notification is warranted* given
 * an already-committed credit, and is safe to call redundantly: the outbox
 * insert is deduped on `notif:miles-earned:<eventId>`.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { getNextRewardSummary } from "@/lib/akiba/nextReward";
import { isMilesEarnedNotificationEnabledFor } from "@/lib/akiba/milesEarnedNotificationsRollout";

// Authoritative event contract (§6.2).
export type MilesCreditedEvent = {
  eventId: string;
  hubUserId: string;
  canonicalId?: string;
  merchantId: string;
  merchantName: string;
  milesAwarded: number;
  source: "merchant_scan" | "merchant_purchase";
  occurredAt: string;
  purchaseEventId?: string;
};

// Per-event award cap (§6.3 "amountMiles: positive integer within the
// configured per-event award cap") — a sanity ceiling, not a business rule;
// an event above this is almost certainly a bug upstream, so it's refused
// rather than shown to a member as a giant, alarming Miles credit.
const MAX_AWARD_MILES_PER_EVENT = 100_000;

export type ProduceMilesEarnedResult =
  | { ok: true }
  | { ok: false; skipped: "notifications_disabled" | "non_positive_amount" | "exceeds_cap" | "insert_failed" };

export async function produceMilesEarnedNotification(
  event: MilesCreditedEvent,
): Promise<ProduceMilesEarnedResult> {
  if (!isMilesEarnedNotificationEnabledFor(event.hubUserId, event.merchantId)) {
    return { ok: false, skipped: "notifications_disabled" };
  }
  if (!Number.isInteger(event.milesAwarded) || event.milesAwarded <= 0) {
    return { ok: false, skipped: "non_positive_amount" };
  }
  if (event.milesAwarded > MAX_AWARD_MILES_PER_EVENT) {
    console.error("[miles-earned] award exceeds per-event cap, refusing to notify:", event.eventId, event.milesAwarded);
    return { ok: false, skipped: "exceeds_cap" };
  }

  const admin = createAdminClient();
  const amountMiles = event.milesAwarded;
  const merchantName = (event.merchantName ?? "").trim().slice(0, 60) || "an Akiba merchant";

  // Next Reward enrichment (§6.4) — a snapshot taken now, not recomputed
  // when the notification is later rendered. Failure degrades to the
  // generic template; it must never block the earned-Miles notification.
  let nextReward: {
    templateId: string;
    benefitLabel: string;
    merchantName: string;
    gapMiles: number;
    affordable: boolean;
  } | null = null;
  try {
    const summary = await getNextRewardSummary({ hubUserId: event.hubUserId, email: null });
    if (summary.state === "recommended") {
      nextReward = {
        templateId: summary.target.templateId,
        benefitLabel: summary.target.benefitLabel.slice(0, 80),
        merchantName: summary.target.merchantName,
        gapMiles: summary.progress.gapMiles,
        affordable: summary.progress.affordable,
      };
    }
  } catch (err) {
    console.error("[miles-earned] getNextRewardSummary failed, using generic template:", err);
  }

  const deepLink = nextReward
    ? nextReward.affordable
      ? `/vouchers/${nextReward.templateId}`
      : "/me#next-reward"
    : "/me/activity";

  const { error } = await admin.from("notification_outbox").upsert(
    {
      user_ref: event.hubUserId,
      hub_user_id: event.hubUserId,
      template: "miles_earned",
      category: "earnings",
      deep_link: deepLink,
      dedupe_key: `notif:miles-earned:${event.eventId}`,
      metadata: {
        eventId: event.eventId,
        amountMiles,
        merchantId: event.merchantId,
        merchantName,
        nextReward,
      },
    },
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );

  if (error) {
    console.error("[miles-earned] notification_outbox upsert failed:", error.message);
    return { ok: false, skipped: "insert_failed" };
  }

  return { ok: true };
}
