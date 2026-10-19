// Web Push (W3C + VAPID) adapter.
//
// This is the original dispatch loop, moved behind the adapter contract with
// its behaviour intact: the same per-subscription delivery upsert, the same
// 404/410 -> 'gone' retirement, the same 408/429/5xx -> retry, the same
// "every send failed with the same auth status" global-config detection that
// deliberately does NOT revoke endpoints. Nothing about the web path changed
// when native push was added; only the reporting shape did.
import type { SupabaseClient } from "@supabase/supabase-js";

import { getWebPushClient } from "../vapid";
import type { AdapterResult, PushJob } from "./types";

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  failure_count: number;
};

export async function sendWebPush(
  admin: SupabaseClient,
  job: PushJob,
  payload: string,
): Promise<AdapterResult> {
  const { data: subs, error: subsErr } = await admin
    .from("web_push_subscriptions")
    .select("id, endpoint, p256dh, auth_secret, failure_count")
    .eq("hub_user_id", job.hub_user_id)
    .eq("status", "active");

  if (subsErr) {
    console.error("[process-push-jobs] failed to load subscriptions:", subsErr.message);
    return { targets: 0, accepted: 0, anyRetryable: true, configError: false, lastError: subsErr.message };
  }

  const subscriptions = (subs ?? []) as SubscriptionRow[];
  if (subscriptions.length === 0) {
    return { targets: 0, accepted: 0, anyRetryable: false, configError: false, lastError: null };
  }

  const webpush = getWebPushClient();

  let accepted = 0;
  let anyRetryable = false;
  let allSameAuthError = true;
  let firstAuthStatus: number | null = null;
  let lastError: string | null = null;

  for (const sub of subscriptions) {
    const { data: existingDelivery } = await admin
      .from("web_push_deliveries")
      .select("id, attempts, status")
      .eq("job_id", job.job_id)
      .eq("subscription_id", sub.id)
      .maybeSingle();

    // Already delivered (or the subscription is gone) on a prior attempt at
    // this job — a retry means *another* subscription needs another try,
    // not that this one should be resent.
    if (existingDelivery?.status === "accepted" || existingDelivery?.status === "gone") {
      if (existingDelivery.status === "accepted") accepted++;
      continue;
    }

    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_secret },
        },
        payload
      );

      await admin
        .from("web_push_deliveries")
        .upsert(
          {
            id: existingDelivery?.id,
            job_id: job.job_id,
            subscription_id: sub.id,
            status: "accepted",
            attempts: (existingDelivery?.attempts ?? 0) + 1,
            provider_status: 201,
            accepted_at: new Date().toISOString(),
            last_error: null,
          },
          { onConflict: "job_id,subscription_id" }
        );

      await admin
        .from("web_push_subscriptions")
        .update({ failure_count: 0, last_success_at: new Date().toISOString() })
        .eq("id", sub.id);

      accepted++;
      allSameAuthError = false;
    } catch (err) {
      const statusCode = (err as { statusCode?: number })?.statusCode ?? null;
      const message = (err as Error)?.message ?? "push send failed";
      lastError = message;

      let deliveryStatus: "gone" | "retry" | "failed" = "failed";
      if (statusCode === 404 || statusCode === 410) {
        deliveryStatus = "gone";
        await admin
          .from("web_push_subscriptions")
          .update({ status: "expired", last_failure_at: new Date().toISOString() })
          .eq("id", sub.id);
      } else if (statusCode === 408 || statusCode === 429 || (statusCode && statusCode >= 500)) {
        deliveryStatus = "retry";
        anyRetryable = true;
        allSameAuthError = false;
      } else if (statusCode === 401 || statusCode === 403) {
        if (firstAuthStatus === null) firstAuthStatus = statusCode;
        else if (firstAuthStatus !== statusCode) allSameAuthError = false;
        deliveryStatus = "retry";
        anyRetryable = true;
      } else {
        deliveryStatus = "failed";
        allSameAuthError = false;
        await admin
          .from("web_push_subscriptions")
          .update({
            status: "revoked",
            revoked_at: new Date().toISOString(),
            last_failure_at: new Date().toISOString(),
            failure_count: sub.failure_count + 1,
          })
          .eq("id", sub.id);
      }

      await admin
        .from("web_push_deliveries")
        .upsert(
          {
            id: existingDelivery?.id,
            job_id: job.job_id,
            subscription_id: sub.id,
            status: deliveryStatus,
            attempts: (existingDelivery?.attempts ?? 0) + 1,
            provider_status: statusCode,
            last_error: message.slice(0, 2000),
          },
          { onConflict: "job_id,subscription_id" }
        );
    }
  }

  // Every send in the batch hit the same auth error -- this is a global
  // VAPID/configuration problem, not N bad endpoints. Don't revoke them.
  const configError = firstAuthStatus !== null && allSameAuthError && subscriptions.length > 1;

  return {
    targets: subscriptions.length,
    accepted,
    anyRetryable,
    configError,
    lastError: configError ? `push provider rejected all sends with ${firstAuthStatus}` : lastError,
  };
}
