// Expo push receipt poller (migration 124).
//
// The send path records Expo's *ticket* — "Expo accepted it" — and stops.
// Whether Apple or Google then delivered it is only reported later as a
// receipt. This pass fetches those receipts and acts on them:
//
//  - DeviceNotRegistered: the app was uninstalled or the token rotated. The
//    device is retired so it stops being sent to (the same thing the send
//    path does when a ticket already says so).
//  - InvalidCredentials / MismatchSenderId: our APNs/FCM credentials in EAS
//    are wrong or missing. Every device fails this way at once, so it is
//    counted and logged loudly as a configuration failure — never blamed on
//    devices.
//
// Expo makes receipts available ~15 minutes after sending and keeps them for
// about a day, so this only looks at sends in that window. A ticket whose
// receipt never appears within the day is marked `expired` rather than
// polled forever.
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";

import { EXPO_RECEIPT_CHUNK_SIZE, classifyExpoReceipt, fetchExpoPushReceipts } from "./expo";

const RECEIPT_READY_AFTER_MS = 15 * 60 * 1000;
const RECEIPT_KEPT_FOR_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = EXPO_RECEIPT_CHUNK_SIZE;

type PendingDelivery = {
  id: string;
  device_id: string;
  /** Null for deliveries recorded before migration 127. */
  push_token: string | null;
  provider_ticket: string;
  accepted_at: string;
};

export type ReceiptRunResult = {
  checked: number;
  delivered: number;
  failed: number;
  retiredDevices: number;
  configErrors: number;
  expired: number;
  pending: number;
};

export async function processPushReceipts(
  admin: SupabaseClient = createAdminClient(),
  now: number = Date.now(),
): Promise<ReceiptRunResult> {
  const result: ReceiptRunResult = {
    checked: 0, delivered: 0, failed: 0, retiredDevices: 0, configErrors: 0, expired: 0, pending: 0,
  };

  const { data, error } = await admin
    .from("native_push_deliveries")
    .select("id, device_id, push_token, provider_ticket, accepted_at")
    .eq("status", "accepted")
    .not("provider_ticket", "is", null)
    .is("receipt_checked_at", null)
    .lte("accepted_at", new Date(now - RECEIPT_READY_AFTER_MS).toISOString())
    .order("accepted_at", { ascending: true })
    .limit(BATCH_SIZE);
  if (error) {
    console.error("[push-receipts] could not load pending deliveries:", error.message);
    return result;
  }

  const deliveries = (data ?? []) as PendingDelivery[];
  if (deliveries.length === 0) return result;

  let receipts;
  try {
    receipts = await fetchExpoPushReceipts(deliveries.map((delivery) => delivery.provider_ticket));
  } catch (err) {
    console.error("[push-receipts] receipt request failed:", (err as Error)?.message ?? err);
    return result;
  }

  const checkedAt = new Date(now).toISOString();
  for (const delivery of deliveries) {
    const receipt = receipts[delivery.provider_ticket];
    if (!receipt) {
      // Not ready yet — unless Expo has already discarded it.
      if (now - Date.parse(delivery.accepted_at) > RECEIPT_KEPT_FOR_MS) {
        await mark(admin, delivery.id, { receipt_status: "expired", receipt_error: null, receipt_checked_at: checkedAt });
        result.expired++;
      } else {
        result.pending++;
      }
      continue;
    }

    result.checked++;
    const outcome = classifyExpoReceipt(receipt);
    if (outcome.ok) {
      await mark(admin, delivery.id, { receipt_status: "ok", receipt_error: null, receipt_checked_at: checkedAt });
      result.delivered++;
      continue;
    }

    result.failed++;
    await mark(admin, delivery.id, {
      receipt_status: "error",
      receipt_error: outcome.error?.slice(0, 2000) ?? null,
      receipt_checked_at: checkedAt,
      ...(outcome.retireDevice ? { status: "gone" } : {}),
    });

    if (outcome.configError) {
      result.configErrors++;
    } else if (outcome.retireDevice && delivery.push_token) {
      // Only while the device still holds the token this receipt is about.
      // Re-registering swaps the token on the same row, and a late receipt
      // for the old token must not disable the new one. Deliveries recorded
      // before migration 127 have no token and never retire a device.
      const { data: retired, error: retireError } = await admin
        .from("hub_user_devices")
        .update({ status: "invalid", last_failure_at: checkedAt })
        .eq("id", delivery.device_id)
        .eq("status", "active")
        .eq("expo_push_token", delivery.push_token)
        .select("id");
      if (retireError) console.error("[push-receipts] device retire failed:", retireError.message);
      else if ((retired ?? []).length > 0) result.retiredDevices++;
    }
  }

  if (result.configErrors > 0) {
    // The one failure that silently stops push for everyone. Loud on purpose.
    console.error(
      `[push-receipts] CONFIG: ${result.configErrors} receipt(s) report InvalidCredentials/MismatchSenderId — ` +
        "check the iOS push key and Android FCM V1 credentials for the app in EAS (eas credentials).",
    );
  }
  return result;
}

async function mark(admin: SupabaseClient, id: string, update: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from("native_push_deliveries").update(update).eq("id", id);
  if (error) console.error("[push-receipts] delivery update failed:", error.message);
}
