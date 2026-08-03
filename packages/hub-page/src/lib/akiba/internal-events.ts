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

export async function sendInternalEvent(job: {
  event_type: string;
  idempotency_key: string;
  identities: Identity[];
  occurred_at: string;
  metadata: Record<string, unknown>;
}): Promise<InternalEventResult> {
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
