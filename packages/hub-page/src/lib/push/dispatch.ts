import { createAdminClient } from "@/lib/supabase/admin";
import { vapidConfigured } from "./vapid";
import { nativePushConfigured } from "./expo";
import { renderTemplate } from "./templates";
import { buildPushPayload } from "./payload";
import { sendWebPush } from "./adapters/web";
import { sendNativePush } from "./adapters/native";
import { NO_TARGETS, type AdapterResult, type PushJob } from "./adapters/types";

const BATCH_SIZE = 25;
const WORKER_ID = `hub-push-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

type PreferenceRow = {
  orders_enabled: boolean;
  vouchers_enabled: boolean;
  rewards_enabled: boolean;
  marketing_enabled: boolean;
  earnings_enabled: boolean;
};

export function categoryEnabled(prefs: PreferenceRow | null, category: string): boolean {
  // No preferences row yet: orders/vouchers/earnings default on, rewards
  // defaults off (hub_notification_preferences, 047_web_push_notifications.sql
  // + 069_earnings_notifications.sql) — referral push is opt-in, earned-Miles
  // push is opt-out (§6.6).
  if (category === "orders" || category === "refunds") return prefs ? prefs.orders_enabled : true;
  if (category === "vouchers") return prefs ? prefs.vouchers_enabled : true;
  if (category === "rewards") return prefs ? prefs.rewards_enabled : false;
  if (category === "marketing") return prefs ? prefs.marketing_enabled : false;
  if (category === "earnings") return prefs ? prefs.earnings_enabled : true;
  return false;
}

export type JobOutcome = "accepted" | "no_active_subscriptions" | "retry" | "config_error";

/**
 * Folds both transports' results into the one outcome
 * complete_web_push_job accepts.
 *
 * The ordering matters and is not arbitrary:
 *  - no targets anywhere is a *completion*, not a failure — the member
 *    simply has no registration, and retrying would never change that;
 *  - a credentials problem outranks a retry, but only when nothing got
 *    through, so one broken transport cannot mask another's success;
 *  - any retryable target keeps the job alive on the existing backoff.
 *
 * Exported for the unit tests, which is also what keeps this logic honest:
 * with one transport configured it must reduce to exactly the behaviour the
 * web-only dispatcher had.
 */
export function combineOutcomes(web: AdapterResult, native: AdapterResult): {
  outcome: JobOutcome;
  error: string | null;
} {
  const targets = web.targets + native.targets;
  if (targets === 0) return { outcome: "no_active_subscriptions", error: null };

  const accepted = web.accepted + native.accepted;
  if ((web.configError || native.configError) && accepted === 0) {
    return { outcome: "config_error", error: web.lastError ?? native.lastError ?? "push configuration error" };
  }

  if (web.anyRetryable || native.anyRetryable) {
    return { outcome: "retry", error: web.lastError ?? native.lastError ?? "one or more deliveries are retryable" };
  }

  return { outcome: "accepted", error: null };
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

  const claimed = (jobs ?? []) as PushJob[];
  let accepted = 0;
  let suppressed = 0;
  let retried = 0;
  let configErrors = 0;

  if (claimed.length === 0) {
    return { claimed: 0, accepted, suppressed, retried, configErrors };
  }

  const webEnabled = vapidConfigured();
  const nativeEnabled = nativePushConfigured();

  if (!webEnabled && !nativeEnabled) {
    // No transport at all is a global configuration failure -- re-arm every
    // claimed job, touch no registrations. (Previously this was the VAPID
    // check alone; a deployment with only native push configured must no
    // longer be treated as misconfigured.)
    for (const job of claimed) {
      await admin.rpc("complete_web_push_job", {
        p_job_id: job.job_id,
        p_outcome: "config_error",
        p_error: "PUSH_TRANSPORT_CONFIG_MISSING",
      });
      configErrors++;
    }
    console.error("[process-push-jobs] no push transport configured; re-armed", claimed.length, "job(s)");
    return { claimed: claimed.length, accepted, suppressed, retried, configErrors };
  }

  for (const job of claimed) {
    let renderMetadata = job.metadata;
    const isAmountBearingReferral = [
      "referral_signup_held",
      "referral_signup_released",
      "referral_activation_held",
      "referral_activation_released",
    ].includes(job.template);
    if (
      isAmountBearingReferral &&
      typeof renderMetadata.amountMiles !== "number" &&
      typeof renderMetadata.referralId === "string"
    ) {
      const { data: referral } = await admin
        .from("hub_referrals")
        .select("signup_reward_miles, activation_reward_miles")
        .eq("id", renderMetadata.referralId)
        .maybeSingle();
      const amountMiles = job.template.includes("activation")
        ? referral?.activation_reward_miles
        : referral?.signup_reward_miles;
      if (typeof amountMiles === "number") {
        renderMetadata = { ...renderMetadata, amountMiles };
      }
    }

    const rendered = renderTemplate(job.template, renderMetadata);
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
      .select("orders_enabled, vouchers_enabled, rewards_enabled, marketing_enabled, earnings_enabled")
      .eq("hub_user_id", job.hub_user_id)
      .maybeSingle();

    // One preference decision for the member, applied to every transport —
    // a category switched off must not leak through on a second channel.
    if (!categoryEnabled(prefs as PreferenceRow | null, job.category)) {
      await admin.rpc("complete_web_push_job", {
        p_job_id: job.job_id,
        p_outcome: "suppressed",
        p_error: "category disabled by user preference",
      });
      suppressed++;
      continue;
    }

    const webResult = webEnabled
      ? await sendWebPush(
          admin,
          job,
          JSON.stringify(buildPushPayload(job.notification_id, job.category, job.deep_link, rendered)),
        )
      : NO_TARGETS;

    const nativeResult = nativeEnabled ? await sendNativePush(admin, job, rendered) : NO_TARGETS;

    const { outcome, error } = combineOutcomes(webResult, nativeResult);

    await admin.rpc("complete_web_push_job", {
      p_job_id: job.job_id,
      p_outcome: outcome,
      ...(error ? { p_error: error } : {}),
    });

    if (outcome === "config_error") configErrors++;
    else if (outcome === "retry") retried++;
    else accepted++;
  }

  return { claimed: claimed.length, accepted, suppressed, retried, configErrors };
}
