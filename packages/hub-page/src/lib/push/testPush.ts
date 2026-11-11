// "Send me a test notification" — a real push to the signed-in member's own
// devices, through the same Expo send path the job queue uses, answered
// synchronously so the member (or whoever is debugging) sees what happened:
// push switched off on the server, no registered device, Expo refused it, or
// sent. The one thing it can't report straight away is final delivery —
// that comes back as a receipt about 15 minutes later
// (src/lib/push/receipts.ts) — so a test that says "sent" but never arrives
// points at APNs/FCM credentials.
//
// Deliberately bypasses notification preferences and the outbox: the member
// asked for this one, and it must not show up in their notification history.
import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildPushPayload } from "./payload";
import { classifyExpoTicket, nativePushConfigured, sendExpoPushChunk, type ExpoPushMessage } from "./expo";

const TEST_MESSAGE = {
  title: "Notifications are working",
  body: "This is a test from Akiba. Miles, offers and reminders will arrive like this.",
};

export type TestPushResult =
  | { status: "push_disabled" }
  | { status: "no_devices" }
  | { status: "sent"; devices: number; accepted: number; errors: string[] }
  | { status: "failed"; devices: number; errors: string[] };

export async function sendTestPush(admin: SupabaseClient, hubUserId: string): Promise<TestPushResult> {
  if (!nativePushConfigured()) return { status: "push_disabled" };

  const { data, error } = await admin
    .from("hub_user_devices")
    .select("id, expo_push_token, platform")
    .eq("hub_user_id", hubUserId)
    .eq("status", "active")
    .not("expo_push_token", "is", null);
  if (error) throw new Error(`device lookup failed: ${error.message}`);

  const devices = (data ?? []) as { id: string; expo_push_token: string; platform: string }[];
  if (devices.length === 0) return { status: "no_devices" };

  const payload = buildPushPayload(randomUUID(), "system", "/", TEST_MESSAGE);
  const messages: ExpoPushMessage[] = devices.map((device) => ({
    to: device.expo_push_token,
    ...TEST_MESSAGE,
    data: payload as unknown as Record<string, unknown>,
    sound: "default",
    priority: "high",
    ...(device.platform === "android" ? { channelId: "default" } : {}),
  }));

  let tickets;
  try {
    // A member has a handful of devices at most — well under one Expo chunk.
    tickets = await sendExpoPushChunk(messages);
  } catch (err) {
    return { status: "failed", devices: devices.length, errors: [(err as Error)?.message ?? "send failed"] };
  }

  let accepted = 0;
  const errors: string[] = [];
  for (let index = 0; index < devices.length; index += 1) {
    const outcome = classifyExpoTicket(tickets[index]);
    if (outcome.status === "accepted") {
      accepted++;
      continue;
    }
    if (outcome.error) errors.push(outcome.error);
    if (outcome.retireDevice) {
      await admin
        .from("hub_user_devices")
        .update({ status: "invalid", last_failure_at: new Date().toISOString() })
        .eq("id", devices[index].id);
    }
  }

  return accepted > 0
    ? { status: "sent", devices: devices.length, accepted, errors }
    : { status: "failed", devices: devices.length, errors };
}
