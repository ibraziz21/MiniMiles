// Server-only adapter — credits/reverses a referral milestone reward on
// Platform's canonical off-chain miles_ledger (referral-system-spec.md §7).
// Same transport convention as internal-events.ts/purchase-events.ts
// (fetch, Bearer AKIBA_API_KEY, 10s timeout, never throws).
//
// Confirmed contract (Platform team, Akiba-Platform migration
// 079_referral_rewards.sql):
//   POST /api/v1/referrals/reward         — 201 new credit / 200 replay
//     (duplicate:true) / 409 IDENTITY_CONFLICT / 409 IDEMPOTENCY_CONFLICT
//     (same key, different amount/reason) / 400 VALIDATION_ERROR.
//   POST /api/v1/referrals/reward/reverse — { idempotencyKey,
//     ledgerReference, reason, metadata } -> { ok, duplicate,
//     ledgerReference, amountMiles, originalLedgerReference }. 404
//     LEDGER_REFERENCE_NOT_FOUND / 409 ALREADY_REVERSED (at most one
//     reversal per credit).
// Both endpoints: hubUserId is Hub-side correlation only, never used for
// identity resolution — only `identities` participates in canonical
// resolution, and a first-seen identity auto-mints a canonical account
// (not an error), matching every other Platform crediting RPC.
import type { Identity } from "@/lib/akiba/identities";

function extractErrorCode(body: Record<string, unknown>, status: number): string {
  const candidate = body.code ?? body.error_code ?? body.errorCode;
  if (typeof candidate === "string" && candidate) return candidate;
  return `platform_http_${status}`;
}

function extractErrorMessage(body: Record<string, unknown>, status: number): string {
  const candidate = body.error ?? body.message;
  if (typeof candidate === "string" && candidate) return candidate;
  return `Platform responded ${status}`;
}

export type ReferralRewardJob = {
  idempotencyKey: string;
  hubUserId: string;
  identities: Identity[];
  amountMiles: number;
  milestone: "signup" | "activation";
  programVersion: number;
  referralId: string;
};

export type ReferralRewardResult =
  | { ok: true; duplicate: boolean; ledgerReference: string; amountMiles: number }
  | { ok: false; error: string; code: string; retryable: boolean };

export async function creditReferralReward(job: ReferralRewardJob): Promise<ReferralRewardResult> {
  const AKIBA_API_URL = process.env.AKIBA_API_URL ?? "";
  const AKIBA_API_KEY = process.env.AKIBA_API_KEY ?? "";

  if (!AKIBA_API_URL || !AKIBA_API_KEY) {
    console.warn("[referral-rewards] AKIBA_API_URL or AKIBA_API_KEY not configured — reward not sent");
    return { ok: false, error: "Platform not configured", code: "hub_not_configured", retryable: true };
  }

  let res: Response;
  try {
    res = await fetch(`${AKIBA_API_URL}/api/v1/referrals/reward`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AKIBA_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": job.idempotencyKey,
      },
      body: JSON.stringify({
        idempotencyKey: job.idempotencyKey,
        recipient: {
          hubUserId: job.hubUserId,
          identities: job.identities,
        },
        amountMiles: job.amountMiles,
        reason: job.milestone === "signup" ? "referral_signup" : "referral_activation",
        sourceApp: "hub",
        metadata: {
          programVersion: job.programVersion,
          referralId: job.referralId,
          milestone: job.milestone,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("[referral-rewards] network error calling Platform:", e);
    return { ok: false, error: "Network error reaching Platform", code: "network_error", retryable: true };
  }

  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* ignore */ }
    console.error("[referral-rewards] Platform returned", res.status, body);
    // §15: 4xx credential/canonical-identity conflicts are operator
    // failures, not infinite retries — only 5xx/429 are worth retrying.
    // IDENTITY_CONFLICT / IDEMPOTENCY_CONFLICT / VALIDATION_ERROR are all
    // 4xx per Platform's contract, so this range check already routes them
    // correctly without needing to special-case the codes individually.
    const retryable = res.status >= 500 || res.status === 429;
    return { ok: false, error: extractErrorMessage(body, res.status), code: extractErrorCode(body, res.status), retryable };
  }

  let body: Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Platform returned an unparseable response", code: "unparseable_response", retryable: true };
  }

  if (body.ok !== true || typeof body.ledgerReference !== "string" || typeof body.amountMiles !== "number") {
    return { ok: false, error: "Platform response missing required fields", code: "malformed_response", retryable: true };
  }

  // Response amount must exactly match the job amount (§7) — a mismatch
  // means Platform resolved this idempotency key to a different reward, not
  // a safe replay. Treat as non-retryable: retrying would just repeat the
  // same mismatch, and it needs an operator to look at it.
  if (body.amountMiles !== job.amountMiles) {
    console.error(
      `[referral-rewards] amount mismatch for ${job.idempotencyKey}: expected ${job.amountMiles}, got ${body.amountMiles}`
    );
    return { ok: false, error: "Platform credited a different amount than requested", code: "amount_mismatch", retryable: false };
  }

  return {
    ok: true,
    duplicate: body.duplicate === true,
    ledgerReference: body.ledgerReference,
    amountMiles: body.amountMiles,
  };
}

export type ReferralReversalJob = {
  idempotencyKey: string;
  /** The original credit's ledger reference — referral_reward_jobs.platform_reference. */
  ledgerReference: string;
  reason: string;
  metadata: Record<string, unknown>;
  expectedAmountMiles: number;
};

export type ReferralReversalResult =
  | { ok: true; duplicate: boolean; ledgerReference: string; amountMiles: number; originalLedgerReference: string }
  | { ok: false; error: string; code: string; retryable: boolean };

export async function reverseReferralReward(job: ReferralReversalJob): Promise<ReferralReversalResult> {
  const AKIBA_API_URL = process.env.AKIBA_API_URL ?? "";
  const AKIBA_API_KEY = process.env.AKIBA_API_KEY ?? "";

  if (!AKIBA_API_URL || !AKIBA_API_KEY) {
    console.warn("[referral-rewards] AKIBA_API_URL or AKIBA_API_KEY not configured — reversal not sent");
    return { ok: false, error: "Platform not configured", code: "hub_not_configured", retryable: true };
  }

  let res: Response;
  try {
    res = await fetch(`${AKIBA_API_URL}/api/v1/referrals/reward/reverse`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AKIBA_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": job.idempotencyKey,
      },
      body: JSON.stringify({
        idempotencyKey: job.idempotencyKey,
        ledgerReference: job.ledgerReference,
        reason: job.reason,
        metadata: job.metadata,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("[referral-rewards] network error calling Platform (reverse):", e);
    return { ok: false, error: "Network error reaching Platform", code: "network_error", retryable: true };
  }

  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* ignore */ }
    console.error("[referral-rewards] Platform reverse returned", res.status, body);
    // 404 LEDGER_REFERENCE_NOT_FOUND and 409 ALREADY_REVERSED are both
    // terminal operator conditions, not transient — never retryable
    // regardless of status-code range, unlike the credit path.
    const nonRetryableCodes = new Set(["LEDGER_REFERENCE_NOT_FOUND", "ALREADY_REVERSED"]);
    const code = extractErrorCode(body, res.status);
    const retryable = !nonRetryableCodes.has(code) && (res.status >= 500 || res.status === 429);
    return { ok: false, error: extractErrorMessage(body, res.status), code, retryable };
  }

  let body: Record<string, unknown>;
  try {
    body = await res.json();
  } catch {
    return { ok: false, error: "Platform returned an unparseable response", code: "unparseable_response", retryable: true };
  }

  if (
    body.ok !== true ||
    typeof body.ledgerReference !== "string" ||
    typeof body.amountMiles !== "number" ||
    typeof body.originalLedgerReference !== "string"
  ) {
    return { ok: false, error: "Platform response missing required fields", code: "malformed_response", retryable: true };
  }

  if (body.amountMiles !== job.expectedAmountMiles) {
    console.error(
      `[referral-rewards] reversal amount mismatch for ${job.idempotencyKey}: expected ${job.expectedAmountMiles}, got ${body.amountMiles}`
    );
    return { ok: false, error: "Platform reversed a different amount than requested", code: "amount_mismatch", retryable: false };
  }

  return {
    ok: true,
    duplicate: body.duplicate === true,
    ledgerReference: body.ledgerReference,
    amountMiles: body.amountMiles,
    originalLedgerReference: body.originalLedgerReference,
  };
}
