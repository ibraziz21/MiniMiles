// Server-only adapter — sends an internal_event to Akiba-Platform's
// discovery-quest engine (discovery-quests-spec.md §3, Akiba-Platform
// migration 061). Same transport as purchase-events.ts (Bearer
// AKIBA_API_KEY, never throws) but a different endpoint and payload shape:
// purchase-events.ts reports purchase facts, this reports pass_activated /
// voucher_redeemed / purchase_reversed quest-trigger facts.
//
// Never called directly from a request path — always via the
// internal_event_jobs outbox (044_internal_event_outbox.sql) and its worker
// (api/internal/process-internal-event-jobs), so a Platform outage retries
// with backoff instead of silently dropping a quest completion.
import { createAdminClient } from "@/lib/supabase/admin";
import { buildIdentities } from "@/lib/akiba/identities";
import type { Identity } from "@/lib/akiba/identities";

export type InternalEventResult = {
  ok: boolean;
  error?: string;
};

async function qualifyReferralCandidate(job: {
  occurred_at: string;
  metadata: Record<string, unknown>;
}): Promise<InternalEventResult> {
  const referredUserId = job.metadata.referredUserId;
  const qualificationType = job.metadata.qualificationType;
  const qualificationReference = job.metadata.qualificationReference;
  const grossAmountKes = job.metadata.grossAmountKes;

  if (
    typeof referredUserId !== "string" ||
    typeof qualificationType !== "string" ||
    typeof qualificationReference !== "string" ||
    typeof grossAmountKes !== "number" ||
    !Number.isFinite(grossAmountKes)
  ) {
    return { ok: false, error: "Invalid referral activation candidate metadata" };
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("qualify_referral_activation", {
    p_referred_user_id: referredUserId,
    p_qualification_type: qualificationType,
    p_qualification_reference: qualificationReference,
    p_gross_amount_kes: grossAmountKes,
    p_occurred_at: job.occurred_at,
  });

  if (error) return { ok: false, error: error.message };

  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; error_code?: string | null }
    | null;
  if (row?.ok) return { ok: true };

  // These are completed evaluations, not delivery failures. Replaying them
  // cannot make the candidate eligible later and would only churn the queue.
  const terminal = new Set([
    "no_referral",
    "invalid_type",
    "predates_pass_creation",
    "activation_window_expired",
    "below_threshold",
    "duplicate_proof",
  ]);
  if (row?.error_code && terminal.has(row.error_code)) return { ok: true };

  return { ok: false, error: row?.error_code ?? "Referral qualification failed" };
}

export async function sendInternalEvent(job: {
  event_type: string;
  idempotency_key: string;
  identities: Identity[];
  occurred_at: string;
  metadata: Record<string, unknown>;
}): Promise<InternalEventResult> {
  if (job.event_type === "referral_activation_candidate") {
    return qualifyReferralCandidate(job);
  }

  // Merchant quest completion/reward is now written through the shared
  // canonical registry. Acknowledging these legacy outbox jobs locally keeps
  // their durable audit trail while preventing Platform from issuing a second
  // reward for the same api_partner_quests action.
  if (new Set([
    "pass_activated",
    "deal_viewed",
    "sponsored_game_played",
    "profile_country_set",
    "voucher_redeemed",
  ]).has(job.event_type)) {
    return { ok: true };
  }

  const AKIBA_API_URL = process.env.AKIBA_API_URL ?? "";
  const AKIBA_API_KEY = process.env.AKIBA_API_KEY ?? "";

  if (!AKIBA_API_URL || !AKIBA_API_KEY) {
    console.warn("[internal-events] AKIBA_API_URL or AKIBA_API_KEY not configured — event skipped");
    return { ok: false, error: "Platform not configured" };
  }

  let res: Response;
  try {
    res = await fetch(`${AKIBA_API_URL}/api/v1/events/track`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${AKIBA_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": job.idempotency_key,
      },
      body: JSON.stringify({
        eventType: job.event_type,
        identities: job.identities,
        idempotencyKey: job.idempotency_key,
        occurredAt: job.occurred_at,
        metadata: job.metadata,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("[internal-events] network error calling Platform:", e);
    return { ok: false, error: "Network error reaching Platform" };
  }

  if (!res.ok) {
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* ignore */ }
    console.error("[internal-events] Platform returned", res.status, body);
    return { ok: false, error: `Platform responded ${res.status}` };
  }

  return { ok: true };
}

/**
 * Re-enqueues pass_activated with the SAME idempotency key after a wallet
 * links to an already-signed-up hub account (spec §2.3). Platform's
 * checkIdempotency unions the incoming identities into the stored event on
 * a matching-key replay rather than rejecting it, which is what makes
 * "email signup today, wallet linked tomorrow" work without any special
 * casing on this side.
 *
 * idempotency_key is UNIQUE on internal_event_jobs, and the original job for
 * this key has normally already reached 'released' by the time a wallet
 * links — a plain insert would just 23505-conflict against that row and do
 * nothing. Upsert instead: reset the existing row to 'pending' with the
 * richer identity list so the worker redelivers it (Platform's own replay
 * handling makes redelivering an already-released key safe — it's a merge,
 * not a duplicate completion).
 */
export async function reemitPassActivated(opts: {
  userId: string;
  email: string | null;
}): Promise<void> {
  const admin = createAdminClient();
  const identities = await buildIdentities(opts);
  if (identities.length === 0) return;

  const { error } = await admin
    .from("internal_event_jobs")
    .upsert(
      {
        event_type: "pass_activated",
        idempotency_key: `pass:${opts.userId}`,
        identities,
        metadata: { userId: opts.userId, reemitted: true },
        status: "pending",
        next_retry_at: null,
      },
      { onConflict: "idempotency_key" }
    );

  if (error) {
    console.error("[internal-events] reemitPassActivated upsert failed:", error.message);
  }
}
