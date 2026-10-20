#!/usr/bin/env node
// Proves the account-deletion completion email can actually be delivered,
// before a real deletion depends on it.
//
//   node scripts/verify-completion-email.mjs you@example.com
//
// Why this exists. The adapter in src/lib/akiba/accountDeletionEmail.ts
// deliberately never reads the provider's response body, because provider
// error payloads routinely echo the recipient address back — so a failure
// surfaces as a bounded `provider_http_403` with no explanation. That is the
// right call for a path handling a member's address, and it makes diagnosis
// impossible from the logs alone.
//
// This script sends to an address *the operator supplies*, not a member's,
// so it can safely read the body and say what actually went wrong. The most
// likely failure by far is an unverified sending domain, which Resend
// answers with 403 and the worker records as non-retryable: configuration
// looks correct, every send fails, and nobody is told.
//
// It mirrors the adapter's request rather than importing it (the adapter is
// TypeScript). To stop the two drifting, it reads the adapter source and
// fails if the endpoint or the default from-address no longer match.
import { argv, env, exit } from "node:process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ADAPTER = resolve(here, "../src/lib/akiba/accountDeletionEmail.ts");

const recipient = argv[2];
if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) {
  console.error("\nusage: node scripts/verify-completion-email.mjs <your-address@example.com>\n");
  console.error("Send to an address you control. Never a member's.\n");
  exit(2);
}

// ── Keep in step with the adapter ────────────────────────────────────────
const source = readFileSync(ADAPTER, "utf8");
const endpoint = /fetch\("(https:\/\/api\.resend\.com\/emails)"/.exec(source)?.[1];
const defaultFrom = /ACCOUNT_DELETION_EMAIL_FROM\?\.trim\(\) \|\| "([^"]+)"/.exec(source)?.[1];

if (!endpoint || !defaultFrom) {
  console.error("Could not read the endpoint or default from-address out of the adapter.");
  console.error("It has changed shape — update this script before trusting it.");
  exit(1);
}

// ── Configuration the worker checks ──────────────────────────────────────
const provider = env.ACCOUNT_DELETION_EMAIL_PROVIDER?.trim().toLowerCase() ?? "";
const apiKey = env.RESEND_API_KEY?.trim() ?? "";
const from = env.ACCOUNT_DELETION_EMAIL_FROM?.trim() || defaultFrom;

console.log("\nCompletion email — delivery check\n");
console.log(`  provider   ${provider || "(unset)"}`);
console.log(`  api key    ${apiKey ? `set, ${apiKey.length} chars` : "(unset)"}`);
console.log(`  from       ${from}${env.ACCOUNT_DELETION_EMAIL_FROM ? "" : "  (adapter default)"}`);
console.log(`  to         ${recipient}`);

if (provider !== "resend") {
  console.log("\n  ACCOUNT_DELETION_EMAIL_PROVIDER is not 'resend'.");
  console.log("  isCompletionEmailConfigured() returns false, so the worker skips the");
  console.log("  delivery pass entirely — deletions complete with the notice undelivered,");
  console.log("  visible in account_deletion_reconciliation.completion_email_pending_count.\n");
  exit(1);
}
if (!apiKey) {
  console.log("\n  RESEND_API_KEY is unset — the adapter returns provider_key_missing,");
  console.log("  non-retryable.\n");
  exit(1);
}

const domain = from.includes("<") ? from.split("<")[1].replace(">", "").split("@")[1] : from.split("@")[1];

// ── The real send ────────────────────────────────────────────────────────
let response;
try {
  response = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [recipient],
      subject: "Akiba — completion email delivery check",
      text: [
        "This is a delivery check for the Akiba account-deletion completion email.",
        "",
        "It confirms the sending domain is verified and the API key works.",
        "No account has been deleted and no member data is involved.",
      ].join("\n"),
    }),
    signal: AbortSignal.timeout(15_000),
  });
} catch (error) {
  console.log(`\n  FAILED  transport_${error?.name ?? "unknown"} — the request never completed.`);
  console.log("  The adapter treats this as retryable.\n");
  exit(1);
}

const payload = await response.json().catch(() => null);

console.log("");
if (response.ok) {
  console.log(`  OK      HTTP ${response.status} — Resend accepted it (id ${payload?.id ?? "?"}).`);
  console.log("");
  console.log("  Accepted is not delivered. Check the inbox, and check Resend's");
  console.log("  dashboard for a bounce — the adapter cannot see what happens after");
  console.log("  this point, and neither can the worker.\n");
  exit(0);
}

const message = payload?.message ?? payload?.error?.message ?? "(no message)";
console.log(`  FAILED  HTTP ${response.status} — the adapter would record provider_http_${response.status}`);
console.log(`  retryable: ${response.status >= 500 || response.status === 429}`);
console.log(`  provider says: ${message}`);
console.log("");

if (response.status === 403) {
  console.log(`  Almost certainly the sending domain '${domain}' is not verified in Resend.`);
  console.log("  Add and verify it (Resend → Domains → add DNS records), or set");
  console.log("  ACCOUNT_DELETION_EMAIL_FROM to a verified address.");
  console.log("  This is the failure worth catching here: 4xx is non-retryable, so every");
  console.log("  completion notice fails silently and permanently.");
} else if (response.status === 401) {
  console.log("  The API key is wrong or revoked.");
} else if (response.status === 422) {
  console.log("  Resend rejected the addresses — check the from format and the recipient.");
} else if (response.status === 429) {
  console.log("  Rate limited. Retryable; try again shortly.");
}
console.log("");
exit(1);
