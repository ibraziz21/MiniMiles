import { createAdminClient } from "@/lib/supabase/admin";
import { getWebPushClient, vapidConfigured } from "./vapid";
import { renderTemplate } from "./templates";
import { buildPushPayload } from "./payload";

const BATCH_SIZE = 25;
const WORKER_ID = `hub-push-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

interface ClaimedJob {
  job_id: string;
  notification_id: string;
  hub_user_id: string;
  template: string;
  category: string;
  deep_link: string;
  metadata: Record<string, unknown>;
  attempts: number;
}

interface SubscriptionRow {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  failure_count: number;
}

type PreferenceRow = {
  orders_enabled: boolean;
  vouchers_enabled: boolean;
};

function categoryEnabled(prefs: PreferenceRow | null, category: string): boolean {
  if (!prefs) return true; // no row yet == defaults (orders/vouchers on)
  if (category === "orders" || category === "refunds") return prefs.orders_enabled;
  if (category === "vouchers") return prefs.vouchers_enabled;
  return false;
}

export async function processPushJobs(): Promise<{
  claimed: number;
  accepted: number;
  suppressed: number;
  retried: number;
  configErrors: number;
}> {
  const admin = createAdminClient();

  const { data: jobs, error: claimErr } = await admin.rpc("claim_web_push_jobs", {
    p_limit: BATCH_SIZE,
    p_worker_id: WORKER_ID,
  });
  if (claimErr) {
    console.error("[process-push-jobs] claim_web_push_jobs failed:", claimErr.message);
    return { claimed: 0, accepted: 0, suppressed: 0, retried: 0, configErrors: 0 };
  }

  const claimed = (jobs ?? []) as ClaimedJob[];
  let accepted = 0;
  let suppressed = 0;
  let retried = 0;
  let configErrors = 0;

  if (claimed.length === 0) {
    return { claimed: 0, accepted, suppressed, retried, configErrors };
  }

  if (!vapidConfigured()) {
    // Global configuration failure -- re-arm every claimed job, touch no subscriptions.
    for (const job of claimed) {
      await admin.rpc("complete_web_push_job", {
        p_job_id: job.job_id,
        p_outcome: "config_error",
        p_error: "WEB_PUSH_VAPID_CONFIG_MISSING",
      });
      configErrors++;
    }
    console.error("[process-push-jobs] VAPID not configured; re-armed", claimed.length, "job(s)");
    return { claimed: claimed.length, accepted, suppressed, retried, configErrors };
  }

  const webpush = getWebPushClient();

  for (const job of claimed) {
    const rendered = renderTemplate(job.template);
    if (!rendered) {
      await admin.rpc("complete_web_push_job", {
        p_job_id: job.job_id,
        p_outcome: "suppressed",
        p_error: `unknown template: ${job.template}`,
      });
      suppressed++;
      continue;
    }

    const { data: prefs } = await admin
      .from("hub_notification_preferences")
      .select("orders_enabled, vouchers_enabled")
      .eq("hub_user_id", job.hub_user_id)
      .maybeSingle();

    if (!categoryEnabled(prefs as PreferenceRow | null, job.category)) {
      await admin.rpc("complete_web_push_job", {
        p_job_id: job.job_id,
        p_outcome: "suppressed",
        p_error: "category disabled by user preference",
      });
      suppressed++;
      continue;
    }

    const { data: subs, error: subsErr } = await admin
      .from("web_push_subscriptions")
      .select("id, endpoint, p256dh, auth_secret, failure_count")
      .eq("hub_user_id", job.hub_user_id)
      .eq("status", "active");

    if (subsErr) {
      console.error("[process-push-jobs] failed to load subscriptions:", subsErr.message);
      await admin.rpc("complete_web_push_job", {
        p_job_id: job.job_id,
        p_outcome: "retry",
        p_error: subsErr.message,
      });
      retried++;
      continue;
    }

    const subscriptions = (subs ?? []) as SubscriptionRow[];
    if (subscriptions.length === 0) {
      await admin.rpc("complete_web_push_job", {
        p_job_id: job.job_id,
        p_outcome: "no_active_subscriptions",
      });
      accepted++;
      continue;
    }

    const payload = JSON.stringify(
      buildPushPayload(job.notification_id, job.category, job.deep_link, rendered)
    );

    let anyRetryable = false;
    let allSameAuthError = true;
    let firstAuthStatus: number | null = null;

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

        allSameAuthError = false;
      } catch (err) {
        const statusCode = (err as { statusCode?: number })?.statusCode ?? null;
        const message = (err as Error)?.message ?? "push send failed";

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

    if (firstAuthStatus !== null && allSameAuthError && subscriptions.length > 1) {
      // Every send in the batch hit the same auth error -- this is a global
      // VAPID/configuration problem, not N bad endpoints. Don't revoke them.
      await admin.rpc("complete_web_push_job", {
        p_job_id: job.job_id,
        p_outcome: "config_error",
        p_error: `push provider rejected all sends with ${firstAuthStatus}`,
      });
      configErrors++;
      continue;
    }

    if (anyRetryable) {
      await admin.rpc("complete_web_push_job", {
        p_job_id: job.job_id,
        p_outcome: "retry",
        p_error: "one or more deliveries are retryable",
      });
      retried++;
    } else {
      await admin.rpc("complete_web_push_job", { p_job_id: job.job_id, p_outcome: "accepted" });
      accepted++;
    }
  }

  return { claimed: claimed.length, accepted, suppressed, retried, configErrors };
}
