// Verifies an FCM V1 service-account key before it is uploaded to EAS.
//
// Does the standard OAuth2 JWT-bearer flow: sign a short-lived assertion
// with the key's private half and exchange it for an access token scoped to
// firebase.messaging. Google only issues that token if the service account
// exists, the key is active, and the account carries a role that grants the
// FCM scope — which is exactly the "wrong IAM role" failure Expo's guide
// warns about, surfaced here instead of as a silent non-delivery later.
//
// Sends no notification and needs no device token. The private key never
// leaves this machine; only a signature over the assertion is transmitted.
import { createSign } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Must match expo.android.package / expo.ios.bundleIdentifier in app.json,
// which the production preflight also pins.
const EXPECTED_PACKAGE = "com.akibamiles.akiba";

const keyPath = process.argv[2];
if (!keyPath) {
  console.error("usage: node verify-fcm-key.mjs <path-to-service-account.json>");
  process.exit(2);
}

const key = JSON.parse(readFileSync(keyPath, "utf8"));

const required = ["type", "project_id", "private_key", "client_email", "token_uri"];
const missing = required.filter((field) => !key[field]);
if (missing.length > 0) {
  console.error(`Not a service-account key — missing: ${missing.join(", ")}`);
  process.exit(1);
}
if (key.type !== "service_account") {
  console.error(`Expected type "service_account", got "${key.type}"`);
  process.exit(1);
}

console.log("Key file");
console.log(`  project_id    ${key.project_id}`);
console.log(`  client_email  ${key.client_email}`);
console.log(`  private_key_id ${key.private_key_id ?? "(absent)"}`);

// ── Cross-check against google-services.json ─────────────────────────────
// The failure this exists for: the app registers with FCM using the project
// in google-services.json, while Expo sends using the project in the
// service-account key. If those differ, every send fails and the symptom —
// a token FCM does not recognise — points nowhere near the cause. It is an
// easy mistake to make with more than one Firebase project in the account,
// and it is invisible until a real device is in hand.
const googleServicesPath = resolve(import.meta.dirname, "../google-services.json");
if (!existsSync(googleServicesPath)) {
  console.log("\ngoogle-services.json");
  console.log("  MISSING from packages/akiba-app — an Android build will fail.");
  console.log("  app.json references ./google-services.json; download it from the");
  console.log("  Firebase project's Android app and commit it.");
} else {
  const services = JSON.parse(readFileSync(googleServicesPath, "utf8"));
  const servicesProjectId = services.project_info?.project_id;
  const servicesProjectNumber = String(services.project_info?.project_number ?? "");
  const packages = (services.client ?? []).map(
    (client) => client.client_info?.android_client_info?.package_name,
  );

  console.log("\ngoogle-services.json");
  console.log(`  project_id      ${servicesProjectId}`);
  console.log(`  project_number  ${servicesProjectNumber}`);
  console.log(`  android package ${packages.join(", ") || "(none)"}`);

  if (servicesProjectId !== key.project_id) {
    console.log("\n  MISMATCH — these are two different Firebase projects.");
    console.log(`    service-account key : ${key.project_id}`);
    console.log(`    google-services.json: ${servicesProjectId}`);
    console.log("\n  The app would register with FCM in one project while Expo sends");
    console.log("  using credentials for the other. Nothing is delivered, and the error");
    console.log("  looks like an unknown device token rather than a configuration fault.");
    console.log("\n  Fix: use a service-account key generated in the same project as");
    console.log(`  google-services.json (${servicesProjectId}), or replace`);
    console.log("  google-services.json with the one from the key's project.");
    process.exit(1);
  }

  if (!packages.includes(EXPECTED_PACKAGE)) {
    console.log(`\n  MISMATCH — no Android app registered for ${EXPECTED_PACKAGE}.`);
    console.log("  Register it in the Firebase project and re-download the file.");
    process.exit(1);
  }

  console.log("  matches the key's project, and the package name is correct.");
}

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const now = Math.floor(Date.now() / 1000);

const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.private_key_id }));
const claims = base64url(
  JSON.stringify({
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri,
    iat: now,
    exp: now + 300,
  }),
);

const signer = createSign("RSA-SHA256");
signer.update(`${header}.${claims}`);
const signature = base64url(signer.sign(key.private_key));
const assertion = `${header}.${claims}.${signature}`;

const response = await fetch(key.token_uri, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  }),
});

const body = await response.json().catch(() => null);

console.log("\nToken exchange");
if (!response.ok) {
  console.log(`  FAILED  HTTP ${response.status}`);
  console.log(`  ${body?.error ?? "unknown"}: ${body?.error_description ?? ""}`);
  console.log("\nCommon causes:");
  console.log("  invalid_grant        — key revoked/deleted, or clock skew on this machine");
  console.log("  invalid_scope        — the service account lacks an FCM-granting role");
  console.log("  unauthorized_client  — the account cannot assert this scope");
  console.log("\nFix: in Google Cloud IAM, grant this service account");
  console.log("'Firebase Cloud Messaging API Admin', then retry.");
  process.exit(1);
}

console.log(`  OK      HTTP ${response.status}`);
console.log(`  scope   ${SCOPE}`);
console.log(`  expires in ${body?.expires_in ?? "?"}s`);
console.log(`  token   ${String(body?.access_token ?? "").slice(0, 12)}… (truncated, not logged in full)`);

// Second check: the FCM v1 send endpoint should answer as an *authorized*
// caller. A deliberately empty message body means a 400 (bad request) is
// the success signal here — it proves authentication and project access
// without sending anything. A 401/403 would mean the token is not accepted
// for this project, and a 404 that FCM is not enabled on it.
const sendUrl = `https://fcm.googleapis.com/v1/projects/${key.project_id}/messages:send`;
const probe = await fetch(sendUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${body.access_token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ validate_only: true, message: {} }),
});

const probeBody = await probe.json().catch(() => null);
console.log("\nFCM v1 send endpoint (validate_only, empty message)");
if (probe.status === 400) {
  console.log("  OK      HTTP 400 — authorized; rejected only because the message is empty");
  console.log("          This is the expected success signal.");
} else if (probe.status === 401 || probe.status === 403) {
  // The full message is what distinguishes "missing IAM role" from "API not
  // enabled on the project" — both arrive as 403 PERMISSION_DENIED and they
  // have completely different fixes.
  console.log(`  FAILED  HTTP ${probe.status} — not authorized to send on project ${key.project_id}`);
  console.log(`  status  ${probeBody?.error?.status ?? "(none)"}`);
  console.log(`  message ${probeBody?.error?.message ?? "(none)"}`);
  if (probeBody?.error?.details) {
    console.log(`  details ${JSON.stringify(probeBody.error.details)}`);
  }
  process.exit(1);
} else if (probe.status === 404) {
  console.log("  FAILED  HTTP 404 — Firebase Cloud Messaging API is not enabled on this project");
  console.log("  Enable it: Google Cloud console → APIs & Services → Firebase Cloud Messaging API");
  process.exit(1);
} else {
  console.log(`  HTTP ${probe.status} — ${JSON.stringify(probeBody?.error?.status ?? probeBody).slice(0, 200)}`);
}

console.log("\nThis key is usable for FCM V1. Upload it to EAS.\n");

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
