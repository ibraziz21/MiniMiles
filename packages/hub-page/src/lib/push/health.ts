// Push health snapshot (GET /api/internal/push-health).
//
// One answer to "is push working?" without a database console: which switches
// are on, how many devices can receive, and what happened to the last day's
// jobs, sends and receipts. Counts and error codes only — no member, token or
// message content.
import type { SupabaseClient } from "@supabase/supabase-js";

import { getMilesEarnedRolloutConfig } from "@/lib/akiba/milesEarnedNotificationsRollout";
import { getDiscoveryContributionsRolloutConfig } from "@/lib/akiba/discoveryContributionsRollout";

import { nativePushConfigured } from "./expo";
import { vapidConfigured } from "./vapid";

const DAY_MS = 24 * 60 * 60 * 1000;

async function countWhere(
  admin: SupabaseClient,
  table: string,
  filters: Record<string, string>,
  since?: { column: string; iso: string },
): Promise<number | null> {
  let query = admin.from(table).select("id", { count: "exact", head: true });
  for (const [column, value] of Object.entries(filters)) query = query.eq(column, value);
  if (since) query = query.gte(since.column, since.iso);
  const { count, error } = await query;
  return error ? null : count ?? 0;
}

async function countByStatus(
  admin: SupabaseClient,
  table: string,
  column: string,
  values: string[],
  since: { column: string; iso: string },
): Promise<Record<string, number | null>> {
  const entries = await Promise.all(
    values.map(async (value) => [value, await countWhere(admin, table, { [column]: value }, since)] as const),
  );
  return Object.fromEntries(entries);
}

export async function pushHealth(admin: SupabaseClient, now = Date.now()) {
  const since = new Date(now - DAY_MS).toISOString();
  const milesEarned = getMilesEarnedRolloutConfig();
  const contributions = getDiscoveryContributionsRolloutConfig();

  const [iosDevices, androidDevices, jobs, deliveries, receipts, receiptErrors] = await Promise.all([
    countWhere(admin, "hub_user_devices", { status: "active", platform: "ios" }),
    countWhere(admin, "hub_user_devices", { status: "active", platform: "android" }),
    countByStatus(admin, "web_push_jobs", "status", ["pending", "retry", "completed", "suppressed", "dead"], {
      column: "created_at",
      iso: since,
    }),
    countByStatus(admin, "native_push_deliveries", "status", ["accepted", "retry", "gone", "failed"], {
      column: "created_at",
      iso: since,
    }),
    countByStatus(admin, "native_push_deliveries", "receipt_status", ["ok", "error", "expired"], {
      column: "created_at",
      iso: since,
    }),
    admin
      .from("native_push_deliveries")
      .select("receipt_error")
      .eq("receipt_status", "error")
      .gte("created_at", since)
      .limit(500),
  ]);

  // Group receipt failures by Expo's error code (the part before ":").
  const receiptErrorCodes: Record<string, number> = {};
  for (const row of (receiptErrors.data ?? []) as { receipt_error: string | null }[]) {
    const code = (row.receipt_error ?? "unknown").split(":")[0].trim() || "unknown";
    receiptErrorCodes[code] = (receiptErrorCodes[code] ?? 0) + 1;
  }

  const warnings: string[] = [];
  if (!nativePushConfigured()) warnings.push("NATIVE_PUSH_ENABLED is not true: apps never register and no phone is sent anything.");
  if (!milesEarned.enabled) warnings.push("HUB_MILES_EARNED_NOTIFICATIONS_ENABLED is off: no Miles-earned notifications are created.");
  else if (milesEarned.percentage === 0 && milesEarned.allowlist.size === 0) {
    warnings.push("HUB_MILES_EARNED_NOTIFICATIONS_ROLLOUT_PERCENT is 0 with no allowlist: nobody gets Miles-earned notifications.");
  }
  if (milesEarned.merchantAllowlist.size > 0) {
    warnings.push(`Miles-earned notifications are limited to ${milesEarned.merchantAllowlist.size} pilot merchant(s).`);
  }
  if ((receiptErrorCodes.InvalidCredentials ?? 0) + (receiptErrorCodes.MismatchSenderId ?? 0) > 0) {
    warnings.push("Expo reports credential errors: check the iOS push key and Android FCM V1 key for the app in EAS.");
  }
  if ((jobs.dead ?? 0) > 0) warnings.push(`${jobs.dead} push job(s) gave up in the last 24h.`);

  return {
    config: {
      nativePushEnabled: nativePushConfigured(),
      webPushConfigured: vapidConfigured(),
      expoAccessTokenSet: Boolean(process.env.EXPO_ACCESS_TOKEN?.trim()),
      milesEarned: {
        enabled: milesEarned.enabled,
        rolloutPercent: milesEarned.percentage,
        allowlistSize: milesEarned.allowlist.size,
        merchantAllowlistSize: milesEarned.merchantAllowlist.size,
      },
      contributionRequests: { enabled: contributions.enabled, rolloutPercent: contributions.percentage },
    },
    activeDevices: { ios: iosDevices, android: androidDevices },
    last24h: { jobs, deliveries, receipts, receiptErrorCodes },
    warnings,
  };
}
