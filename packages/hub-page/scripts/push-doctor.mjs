#!/usr/bin/env node
// Reports which gate is stopping an earned-Miles notification from reaching
// a phone. There are eleven of them between a merchant scan and a banner,
// most are environment rather than code, and each one fails silently — so
// the useful thing is a list that says which.
//
//   node scripts/push-doctor.mjs --user <hubUserId> [--merchant <merchantId>]
//
// Env comes from the shell, same as the other scripts here. To read a
// deployed environment's values instead of your own shell, run it with
// `vercel env pull` output sourced, or pass --base-url to probe the live
// endpoints (see push-simulate.mjs for the end-to-end version).
//
// Deliberately read-only: it sends nothing and writes nothing.
import { argv, env, exit } from "node:process";

const args = parseArgs(argv.slice(2));
const hubUserId = args.user ?? null;
const merchantId = args.merchant ?? null;

const checks = [];

function record(name, state, detail, fix) {
  checks.push({ name, state, detail, fix });
}

// ── 1. Ingestion ──────────────────────────────────────────────────────────
// Akiba-Platform's merchant-scan award service calls
// POST /api/internal/miles-credited with this shared secret. Without it the
// chain never starts, and no amount of app-side configuration matters.
const apiKeys = [env.AKIBA_API_KEY, env.AKIBA_API_KEYS].filter(Boolean).join(",");
record(
  "Platform -> Hub ingestion secret",
  apiKeys ? "pass" : "fail",
  apiKeys ? "AKIBA_API_KEY/AKIBA_API_KEYS is set" : "neither AKIBA_API_KEY nor AKIBA_API_KEYS is set",
  "Set AKIBA_API_KEY and give the same value to Akiba-Platform's award service.",
);

// ── 2. Earned-Miles producer rollout ─────────────────────────────────────
// src/lib/akiba/milesEarnedNotificationsRollout.ts. Off by default, and the
// most common reason a correct end-to-end setup produces nothing.
const rolloutOn = ["1", "true", "yes", "on"].includes(
  (env.HUB_MILES_EARNED_NOTIFICATIONS_ENABLED ?? "").trim().toLowerCase(),
);
record(
  "Earned-Miles notifications enabled",
  rolloutOn ? "pass" : "fail",
  `HUB_MILES_EARNED_NOTIFICATIONS_ENABLED=${env.HUB_MILES_EARNED_NOTIFICATIONS_ENABLED ?? "(unset)"}`,
  "Set HUB_MILES_EARNED_NOTIFICATIONS_ENABLED=true.",
);

const allowlist = splitList(env.HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST);
const merchantAllowlist = splitList(env.HUB_MILES_EARNED_NOTIFICATIONS_MERCHANT_ALLOWLIST);
const percent = clampPercent(env.HUB_MILES_EARNED_NOTIFICATIONS_ROLLOUT_PERCENT);

if (hubUserId) {
  // NOTE: produceMilesEarnedNotification passes `event.hubUserId` as the
  // rollout identifier, not the member's email — so the allowlist must hold
  // the UUID. This trips people up, because the function's own doc comment
  // says "prefer email".
  const inAllowlist = allowlist.includes(hubUserId.trim().toLowerCase());
  if (inAllowlist) {
    record("Member in rollout", "pass", "hubUserId is in HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST", null);
  } else if (percent >= 100) {
    record("Member in rollout", "pass", "rollout percent is 100", null);
  } else if (percent <= 0) {
    record(
      "Member in rollout",
      "fail",
      `hubUserId is not allowlisted and rollout percent is ${percent}`,
      `Add ${hubUserId} to HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST — an allowlist entry short-circuits the percentage, which makes a test deterministic.`,
    );
  } else {
    record(
      "Member in rollout",
      "warn",
      `hubUserId is not allowlisted and a ${percent}% bucket decides — the answer is deterministic but not readable here`,
      `Add ${hubUserId} to HUB_MILES_EARNED_NOTIFICATIONS_ALLOWLIST so the test does not depend on the hash bucket.`,
    );
  }
} else {
  record("Member in rollout", "skip", "pass --user <hubUserId> to check this", null);
}

if (merchantAllowlist.length === 0) {
  record("Merchant in pilot cohort", "pass", "merchant allowlist is empty, so every merchant qualifies", null);
} else if (!merchantId) {
  record(
    "Merchant in pilot cohort",
    "warn",
    `merchant allowlist has ${merchantAllowlist.length} entr${merchantAllowlist.length === 1 ? "y" : "ies"}; pass --merchant to check yours`,
    null,
  );
} else if (merchantAllowlist.includes(merchantId.trim().toLowerCase())) {
  record("Merchant in pilot cohort", "pass", "merchantId is allowlisted", null);
} else {
  record(
    "Merchant in pilot cohort",
    "fail",
    "a merchant allowlist is set and this merchantId is not in it — while set, it overrides the member percentage entirely",
    `Add ${merchantId} to HUB_MILES_EARNED_NOTIFICATIONS_MERCHANT_ALLOWLIST, or clear the variable.`,
  );
}

// ── 3. Queue drain ───────────────────────────────────────────────────────
// vercel.json runs /api/internal/process-push-jobs every minute in a
// deployed environment. Locally nothing runs it, so a job sits in
// web_push_jobs looking like a delivery failure when it is simply unclaimed.
record(
  "Worker invocation secret",
  env.INTERNAL_WEBHOOK_SECRET ? "pass" : "fail",
  env.INTERNAL_WEBHOOK_SECRET ? "INTERNAL_WEBHOOK_SECRET is set" : "INTERNAL_WEBHOOK_SECRET is unset",
  "Set INTERNAL_WEBHOOK_SECRET so process-push-jobs can be POSTed by hand; Vercel Cron uses CRON_SECRET on GET instead.",
);
record(
  "Cron secret (deployed environments)",
  env.CRON_SECRET ? "pass" : "warn",
  env.CRON_SECRET ? "CRON_SECRET is set" : "CRON_SECRET is unset — the every-minute cron GET would 401",
  "Set CRON_SECRET in the deployed environment. Not needed for a local POST.",
);

// ── 4. Transport ─────────────────────────────────────────────────────────
const nativeOn = (env.NATIVE_PUSH_ENABLED ?? "").trim().toLowerCase() === "true";
record(
  "Native push transport enabled",
  nativeOn ? "pass" : "fail",
  `NATIVE_PUSH_ENABLED=${env.NATIVE_PUSH_ENABLED ?? "(unset)"}`,
  "Set NATIVE_PUSH_ENABLED=true. While off, bootstrap reports capabilities.nativePush false, the app never asks for permission, and POST /api/v1/me/devices refuses registrations.",
);
record(
  "Expo access token",
  env.EXPO_ACCESS_TOKEN ? "pass" : "warn",
  env.EXPO_ACCESS_TOKEN ? "EXPO_ACCESS_TOKEN is set" : "EXPO_ACCESS_TOKEN is unset",
  "Only required when the Expo project has enhanced push security enabled. Unset is fine otherwise.",
);

const vapid = [
  env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY,
  env.WEB_PUSH_VAPID_PRIVATE_KEY,
  env.WEB_PUSH_VAPID_SUBJECT,
].filter(Boolean).length;
record(
  "Web push (unrelated to native, shown for contrast)",
  vapid === 3 ? "pass" : vapid === 0 ? "skip" : "warn",
  vapid === 3 ? "VAPID trio configured" : vapid === 0 ? "not configured" : `${vapid}/3 VAPID values set`,
  vapid === 1 || vapid === 2 ? "Set all three or none — getServerEnv() rejects a partial trio in production." : null,
);

// ── 5. Things this script cannot see ─────────────────────────────────────
const manual = [
  [
    "Migration 101 applied",
    "supabase/migrations/101_native_push_devices.sql creates hub_user_devices and native_push_deliveries. Without it, device registration 500s. Check: select 1 from hub_user_devices limit 1;",
  ],
  [
    "APNs key + FCM credentials uploaded to Expo",
    "Run `eas credentials`. Android uses FCM V1 (Google Service Account), not the Legacy API key. Until both exist, Expo accepts the send and then drops it — the job completes as 'accepted' and no banner ever appears. This is the single most misleading failure in the chain.",
  ],
  [
    "Firebase Cloud Messaging API enabled on the Firebase project",
    "A valid service-account key on a project with the API switched off authenticates perfectly and refuses every send with 403 SERVICE_DISABLED. Check it before trusting the key: pnpm --filter @akiba/akiba-app push:verify-fcm <key.json> — HTTP 400 from the send probe is the success signal.",
  ],
  [
    "google-services.json present in packages/akiba-app",
    "Required for the Android app to register with FCM; app.json already references ./google-services.json, so an Android build fails until the file is added. It holds only public identifiers and is safe to commit (unlike the service-account key).",
  ],
  [
    "App is a development or preview build, not Expo Go",
    "expo-notifications is a native module and app.json gained its config plugin, so the app must be rebuilt: `npx expo run:ios` / `run:android`, or `eas build --profile preview`.",
  ],
  [
    "A device is registered for the test member",
    "The app registers after onboarding completes and permission is granted. Check: select platform, status, last_seen_at from hub_user_devices where hub_user_id = '<uuid>';",
  ],
  [
    "Member has not switched the earnings category off",
    "Defaults on. Check: select earnings_enabled from hub_notification_preferences where hub_user_id = '<uuid>';",
  ],
];

// ── Report ────────────────────────────────────────────────────────────────
const ICON = { pass: "  ok  ", fail: " FAIL ", warn: " warn ", skip: " skip " };

console.log("\nEarned-Miles push — configuration check\n");
for (const check of checks) {
  console.log(`[${ICON[check.state]}] ${check.name}`);
  console.log(`          ${check.detail}`);
  if (check.fix && check.state !== "pass") console.log(`          → ${check.fix}`);
}

console.log("\nNot checkable from here — verify by hand:\n");
for (const [name, detail] of manual) {
  console.log(`  · ${name}`);
  console.log(`      ${detail}`);
}

const failures = checks.filter((check) => check.state === "fail");
console.log("");
if (failures.length === 0) {
  console.log("No configuration gate is failing. If a notification still does not arrive, it is");
  console.log("almost certainly one of the manual items above — most often Expo credentials.\n");
} else {
  console.log(`${failures.length} gate${failures.length === 1 ? "" : "s"} failing: ${failures.map((f) => f.name).join(", ")}\n`);
}

exit(failures.length === 0 ? 0 : 1);

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

function splitList(value) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function clampPercent(value) {
  const parsed = Number(value ?? "0");
  return Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.trunc(parsed))) : 0;
}
