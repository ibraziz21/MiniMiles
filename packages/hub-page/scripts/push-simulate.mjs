#!/usr/bin/env node
// Exercises the earned-Miles chain end to end without a merchant scan and
// without the Akiba-Platform repo, by posting the same `miles_credited`
// event Platform's award service posts, then draining the push queue.
//
//   node scripts/push-simulate.mjs \
//     --user <hubUserId> --merchant <merchantId> [--miles 250] \
//     [--merchant-name "Java House"] [--base-url http://localhost:3000] \
//     [--inspect]
//
// Needs AKIBA_API_KEY (to be accepted as Platform) and
// INTERNAL_WEBHOOK_SECRET (to drain the queue by hand instead of waiting for
// the every-minute cron). --inspect additionally reads back the resulting
// rows, which needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY.
//
// This is a *write* against whatever environment you point it at: it creates
// a real notification_outbox row and a real push job for a real member, and
// if everything is configured it really does send them a notification. Point
// it at a staging environment and a test account.
import { argv, env, exit } from "node:process";
import { randomUUID } from "node:crypto";

// Matches the route's own validation (src/app/api/internal/miles-credited),
// so a bad id is rejected here with a readable message instead of as a 400.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const args = parseArgs(argv.slice(2));

const baseUrl = (args["base-url"] ?? env.PUSH_SIMULATE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const hubUserId = args.user;
const merchantId = args.merchant ?? randomUUID();
const merchantName = args["merchant-name"] ?? "Java House";
const miles = Number(args.miles ?? 250);
const eventId = args["event-id"] ?? `sim-${randomUUID()}`;

if (!hubUserId) {
  fail("--user <hubUserId> is required (the member's Supabase auth user id).");
}
if (!UUID_RE.test(hubUserId)) {
  fail(`--user must be a UUID; received ${hubUserId}`);
}
if (!Number.isInteger(miles) || miles <= 0) {
  fail(`--miles must be a positive integer; received ${args.miles}`);
}
if (!env.AKIBA_API_KEY) {
  fail("AKIBA_API_KEY is not set — /api/internal/miles-credited authenticates Platform with it.");
}

console.log(`\nSimulating a merchant-scan Miles credit against ${baseUrl}`);
console.log(`  member    ${hubUserId}`);
console.log(`  merchant  ${merchantId} (${merchantName})`);
console.log(`  miles     ${miles}`);
console.log(`  eventId   ${eventId}   (idempotency key — reuse it to prove a retry is safe)\n`);

// ── Step 1: the event Platform would post after its ledger commits ───────
const creditResponse = await post(`${baseUrl}/api/internal/miles-credited`, {
  headers: { Authorization: `Bearer ${env.AKIBA_API_KEY}` },
  body: {
    eventId,
    hubUserId,
    merchantId,
    merchantName,
    milesAwarded: miles,
    source: "merchant_scan",
    occurredAt: new Date().toISOString(),
    channel: "in_store",
  },
});

report("POST /api/internal/miles-credited", creditResponse);

if (!creditResponse.ok) {
  console.log("\nThe chain stopped at ingestion. Run `node scripts/push-doctor.mjs` for the gate list.\n");
  exit(1);
}

// `notified: false` is the quiet failure worth calling out: the request was
// accepted and the credit is real, but the rollout gate declined to produce
// a notification, so nothing downstream will ever exist.
if (creditResponse.body?.notified === false) {
  console.log("\n  ⚠ Accepted, but notified=false — the rollout gate declined this event.");
  console.log("    No outbox row, no job, no notification. Nothing downstream is broken.");
  console.log(`    Run: node scripts/push-doctor.mjs --user ${hubUserId} --merchant ${merchantId}\n`);
  exit(1);
}

// ── Step 2: drain the queue ──────────────────────────────────────────────
// Deployed environments have a cron doing this every minute; locally nothing
// does, so an undrained job looks exactly like a delivery failure.
if (!env.INTERNAL_WEBHOOK_SECRET) {
  console.log("\n  INTERNAL_WEBHOOK_SECRET is unset, so the queue cannot be drained from here.");
  console.log("  The job is enqueued and the cron will pick it up within a minute in a deployed");
  console.log("  environment. Locally, set the secret and re-run, or POST the worker yourself.\n");
  exit(0);
}

const workerResponse = await post(`${baseUrl}/api/internal/process-push-jobs`, {
  headers: { "x-webhook-secret": env.INTERNAL_WEBHOOK_SECRET },
});

report("POST /api/internal/process-push-jobs", workerResponse);

const counts = workerResponse.body ?? {};
console.log("");
if (counts.claimed === 0) {
  console.log("  Nothing was claimed. The enqueue trigger did not create a job — check that");
  console.log("  migration 069 is applied (it adds 'earnings'/'miles_earned' to the push-eligible");
  console.log("  whitelist in enqueue_web_push_job).");
} else if (counts.suppressed > 0) {
  console.log("  Suppressed. Either the template did not render or the member has the earnings");
  console.log("  category switched off (hub_notification_preferences.earnings_enabled).");
} else if (counts.configErrors > 0) {
  console.log("  Configuration error. No transport is usable: NATIVE_PUSH_ENABLED is off and the");
  console.log("  VAPID trio is absent, or the provider rejected every send on credentials.");
} else if (counts.retried > 0) {
  console.log("  Retrying. A transport failed in a way worth another attempt; the job stays armed");
  console.log("  on the existing backoff. Check native_push_deliveries.last_error.");
} else if (counts.accepted > 0) {
  console.log("  Accepted by the provider.");
  console.log("");
  console.log("  Note what this does and does not mean: Expo accepted the message. If the APNs");
  console.log("  key or FCM credentials are missing, Expo accepts and then silently drops it, and");
  console.log("  this still reads 'accepted'. A banner on the device is the only real proof.");
  console.log("  'accepted' with no active device also lands here as no_active_subscriptions.");
}

if (args.inspect === "true") await inspect();

console.log("");
exit(0);

// ── Helpers ──────────────────────────────────────────────────────────────

async function inspect() {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.log("\n  --inspect needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY.");
    return;
  }

  console.log("\nRows this produced:\n");

  const devices = await rest(url, key, `hub_user_devices?hub_user_id=eq.${hubUserId}&select=id,platform,status,failure_count,last_success_at,last_failure_at`);
  console.log(`  hub_user_devices (${devices.length})`);
  for (const device of devices) {
    console.log(`    ${device.platform}  ${device.status}  failures=${device.failure_count}  success=${device.last_success_at ?? "never"}`);
  }
  if (devices.length === 0) {
    console.log("    none — the app has not registered. Nothing native can be delivered.");
  }

  const outbox = await rest(url, key, `notification_outbox?dedupe_key=eq.notif:miles-earned:${encodeURIComponent(eventId)}&select=id,template,category,deep_link`);
  console.log(`\n  notification_outbox (${outbox.length})`);
  for (const row of outbox) {
    console.log(`    ${row.template}  category=${row.category}  deep_link=${row.deep_link}`);
  }

  if (outbox[0]?.id) {
    const jobs = await rest(url, key, `web_push_jobs?notification_id=eq.${outbox[0].id}&select=id,status,attempts,last_error`);
    console.log(`\n  web_push_jobs (${jobs.length})`);
    for (const job of jobs) {
      console.log(`    ${job.status}  attempts=${job.attempts}  ${job.last_error ?? ""}`);
      const deliveries = await rest(url, key, `native_push_deliveries?job_id=eq.${job.id}&select=status,attempts,provider_ticket,last_error`);
      console.log(`    native_push_deliveries (${deliveries.length})`);
      for (const delivery of deliveries) {
        console.log(`      ${delivery.status}  attempts=${delivery.attempts}  ticket=${delivery.provider_ticket ?? "-"}  ${delivery.last_error ?? ""}`);
      }
    }
  }
}

async function rest(url, key, path) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!response.ok) {
    console.log(`    (read failed: ${response.status} ${path.split("?")[0]})`);
    return [];
  }
  return (await response.json().catch(() => [])) ?? [];
}

async function post(url, { headers = {}, body } = {}) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.json().catch(() => null),
    };
  } catch (error) {
    return { ok: false, status: 0, body: { error: error?.message ?? "request failed" } };
  }
}

function report(label, response) {
  const state = response.ok ? "ok" : "FAIL";
  console.log(`[ ${state} ] ${label} → ${response.status || "no response"}`);
  console.log(`         ${JSON.stringify(response.body)}`);
}

function parseArgs(list) {
  const out = {};
  for (let index = 0; index < list.length; index += 1) {
    const token = list[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = list[index + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = "true";
    }
  }
  return out;
}

function fail(message) {
  console.error(`\n${message}\n`);
  exit(1);
}
