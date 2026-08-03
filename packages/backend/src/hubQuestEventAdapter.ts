// Hub Quest Event Delivery, Slice C (hub-quest-event-delivery-spec.md §6.2) —
// Platform adapter used by hubQuestEventWorker.ts. Same payload shape and
// header contract as hub-page's lib/akiba/internal-events.ts sendInternalEvent
// (that adapter stays in place as the Vercel recovery route's sender); this
// is a separate implementation because packages/backend is a plain Node
// service with no workspace import path into packages/hub-page.
import { randomUUID } from "crypto";

export type ClaimedEventJob = {
  id: string;
  event_type: string;
  idempotency_key: string;
  identities: Array<{ type: string; value: string }>;
  occurred_at: string;
  metadata: Record<string, unknown>;
  attempts: number;
};

export type DeliveryOutcome =
  | { action: "release" }
  | { action: "retry"; errorCode: string; errorDetail: string }
  | { action: "fail"; errorCode: string; errorDetail: string; alert: boolean };

function apiUrl(): string {
  return process.env.AKIBA_API_URL ?? "";
}

function apiKey(): string {
  return process.env.AKIBA_API_KEY ?? "";
}

export function hubQuestEventAdapterConfigured(): boolean {
  return Boolean(apiUrl() && apiKey());
}

// Classifies Platform's response per the table in spec §6.2. The worker
// applies its own attempt-count policy on top of "retry" outcomes (e.g.
// failing credential errors after a few tries instead of the default max).
export async function deliverHubQuestEvent(
  job: ClaimedEventJob,
  timeoutMs: number,
): Promise<DeliveryOutcome> {
  const correlationId = randomUUID();
  const body = JSON.stringify({
    eventType: job.event_type,
    identities: job.identities,
    idempotencyKey: job.idempotency_key,
    occurredAt: job.occurred_at,
    metadata: job.metadata,
  });

  let res: Response;
  try {
    res = await fetch(`${apiUrl()}/api/v1/events/track`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": job.idempotency_key,
        "X-Correlation-ID": correlationId,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    return {
      action: "retry",
      errorCode: isTimeout ? "timeout" : "network_error",
      errorDetail: String(err?.message ?? err).slice(0, 500),
    };
  }

  if (res.ok) return { action: "release" };

  let bodyCode: string | undefined;
  try {
    const parsed = await res.json();
    bodyCode = typeof parsed?.code === "string" ? parsed.code : undefined;
  } catch {
    // Never store the raw response body — spec §4.1 forbids leaking
    // upstream response content into logs/health.
  }

  const status = res.status;

  // A stable already-accepted idempotency response is a successful delivery,
  // not a rejection.
  if (status === 409) return { action: "release" };

  if (status === 408 || status === 425 || status === 429 || status >= 500) {
    return { action: "retry", errorCode: bodyCode ?? `http_${status}`, errorDetail: `Platform responded ${status}` };
  }
  if (status === 400) {
    return { action: "fail", errorCode: bodyCode ?? "malformed_event", errorDetail: "Platform responded 400", alert: false };
  }
  if (status === 401 || status === 403) {
    return { action: "retry", errorCode: bodyCode ?? `http_${status}`, errorDetail: `Platform responded ${status}` };
  }
  if (status === 404) {
    return { action: "fail", errorCode: bodyCode ?? "endpoint_mismatch", errorDetail: "Platform responded 404", alert: true };
  }
  if (status === 422) {
    return { action: "fail", errorCode: bodyCode ?? "no_matching_quest", errorDetail: "Platform responded 422", alert: true };
  }
  return { action: "retry", errorCode: bodyCode ?? `http_${status}`, errorDetail: `Unhandled Platform response ${status}` };
}
