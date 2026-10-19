// Native (Expo Push) adapter.
//
// Mirrors the web adapter's contract and its delivery vocabulary, over
// native_push_deliveries instead of web_push_deliveries. The `data` payload
// is deliberately the same PushPayload the service worker already receives,
// so one deep-link format serves both transports and the app does not need a
// native-only envelope.
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildPushPayload } from "../payload";
import type { RenderedNotification } from "../templates";
import {
  ExpoPushTransportError,
  chunkExpoMessages,
  classifyExpoTicket,
  sendExpoPushChunk,
  type ExpoPushMessage,
} from "../expo";
import type { AdapterResult, PushJob } from "./types";

type DeviceRow = {
  id: string;
  expo_push_token: string;
  platform: "ios" | "android";
  failure_count: number;
};

// Must match the channel the app creates at startup; Android drops a
// notification whose channel does not exist.
const ANDROID_CHANNEL_ID = "default";

export async function sendNativePush(
  admin: SupabaseClient,
  job: PushJob,
  rendered: RenderedNotification,
): Promise<AdapterResult> {
  const { data: rows, error: devicesErr } = await admin
    .from("hub_user_devices")
    .select("id, expo_push_token, platform, failure_count")
    .eq("hub_user_id", job.hub_user_id)
    .eq("status", "active")
    .not("expo_push_token", "is", null);

  if (devicesErr) {
    console.error("[process-push-jobs] failed to load devices:", devicesErr.message);
    return { targets: 0, accepted: 0, anyRetryable: true, configError: false, lastError: devicesErr.message };
  }

  const devices = (rows ?? []) as DeviceRow[];
  if (devices.length === 0) {
    return { targets: 0, accepted: 0, anyRetryable: false, configError: false, lastError: null };
  }

  const payload = buildPushPayload(job.notification_id, job.category, job.deep_link, rendered);

  // Skip targets already settled on a previous attempt at this job, the same
  // way the web adapter does — a retry exists for the devices that still
  // need one, not to resend to those that succeeded.
  const { data: existingRows } = await admin
    .from("native_push_deliveries")
    .select("id, device_id, attempts, status")
    .eq("job_id", job.job_id);

  const existing = new Map(
    ((existingRows ?? []) as { id: string; device_id: string; attempts: number; status: string }[]).map(
      (row) => [row.device_id, row],
    ),
  );

  let accepted = 0;
  const pending: DeviceRow[] = [];
  for (const device of devices) {
    const prior = existing.get(device.id);
    if (prior?.status === "accepted") {
      accepted++;
      continue;
    }
    if (prior?.status === "gone") continue;
    pending.push(device);
  }

  if (pending.length === 0) {
    return { targets: devices.length, accepted, anyRetryable: false, configError: false, lastError: null };
  }

  let anyRetryable = false;
  let configError = false;
  let lastError: string | null = null;

  for (const chunk of chunkExpoMessages(pending)) {
    const messages: ExpoPushMessage[] = chunk.map((device) => ({
      to: device.expo_push_token,
      title: rendered.title,
      body: rendered.body,
      data: payload as unknown as Record<string, unknown>,
      sound: "default",
      priority: "high",
      ...(device.platform === "android" ? { channelId: ANDROID_CHANNEL_ID } : {}),
    }));

    let tickets;
    try {
      tickets = await sendExpoPushChunk(messages);
    } catch (err) {
      // The whole request failed, so nothing is known about individual
      // devices. Record one attempt each and let the job decide, without
      // retiring any registration.
      const transportError = err instanceof ExpoPushTransportError ? err : null;
      const message = (err as Error)?.message ?? "expo push send failed";
      lastError = message;
      if (transportError?.configError) configError = true;
      if (transportError?.retryable ?? true) anyRetryable = true;

      for (const device of chunk) {
        await recordDelivery(admin, job.job_id, device.id, existing.get(device.id), {
          status: transportError?.retryable ?? true ? "retry" : "failed",
          providerStatus: transportError?.statusCode ?? null,
          ticketId: null,
          error: message,
        });
      }
      continue;
    }

    for (let index = 0; index < chunk.length; index += 1) {
      const device = chunk[index];
      const outcome = classifyExpoTicket(tickets[index]);

      if (outcome.status === "accepted") accepted++;
      if (outcome.status === "retry") anyRetryable = true;
      if (outcome.configError) configError = true;
      if (outcome.error) lastError = outcome.error;

      if (outcome.retireDevice) {
        await admin
          .from("hub_user_devices")
          .update({
            status: "invalid",
            last_failure_at: new Date().toISOString(),
            failure_count: device.failure_count + 1,
          })
          .eq("id", device.id);
      } else if (outcome.status === "accepted") {
        await admin
          .from("hub_user_devices")
          .update({ failure_count: 0, last_success_at: new Date().toISOString() })
          .eq("id", device.id);
      } else if (!outcome.configError) {
        await admin
          .from("hub_user_devices")
          .update({
            last_failure_at: new Date().toISOString(),
            failure_count: device.failure_count + 1,
          })
          .eq("id", device.id);
      }

      await recordDelivery(admin, job.job_id, device.id, existing.get(device.id), {
        status: outcome.status,
        providerStatus: null,
        ticketId: outcome.ticketId,
        error: outcome.error,
      });
    }
  }

  return { targets: devices.length, accepted, anyRetryable, configError, lastError };
}

async function recordDelivery(
  admin: SupabaseClient,
  jobId: string,
  deviceId: string,
  prior: { id: string; attempts: number } | undefined,
  outcome: {
    status: "accepted" | "retry" | "gone" | "failed";
    providerStatus: number | null;
    ticketId: string | null;
    error: string | null;
  },
): Promise<void> {
  const { error } = await admin.from("native_push_deliveries").upsert(
    {
      id: prior?.id,
      job_id: jobId,
      device_id: deviceId,
      status: outcome.status,
      attempts: (prior?.attempts ?? 0) + 1,
      provider_status: outcome.providerStatus,
      provider_ticket: outcome.ticketId,
      last_error: outcome.error ? outcome.error.slice(0, 2000) : null,
      accepted_at: outcome.status === "accepted" ? new Date().toISOString() : null,
    },
    { onConflict: "job_id,device_id" },
  );

  if (error) {
    // An audit write failing must not change what the member received, so
    // this is logged rather than thrown; the job's own outcome already
    // reflects the send.
    console.error("[process-push-jobs] native delivery upsert failed:", error.message);
  }
}
