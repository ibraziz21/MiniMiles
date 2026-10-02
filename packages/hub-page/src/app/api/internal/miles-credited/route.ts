/**
 * POST /api/internal/miles-credited
 *
 * Fallback ingestion point for the authoritative `miles_credited` event
 * contract (akiba-pass-navigation-rewards-earned-notifications-v1-spec.md
 * §6.2) — for upstream systems (Akiba-Platform's merchant-scan award
 * service) that cannot yet call the shared notification producer directly.
 * Resolving a Pass through /api/me/pass/resolve is NOT proof of a credit;
 * this endpoint must only be called after the caller's own ledger
 * transaction has committed. A network failure here must be retryable by
 * the caller's outbox — the response is idempotent on `eventId`.
 *
 * Authentication: Authorization: Bearer <AKIBA_API_KEY> — the same
 * Hub<->Platform shared secret already used for inbound Platform calls
 * (see /api/me/pass/resolve), rotatable via AKIBA_API_KEYS.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { produceMilesEarnedNotification, type MilesCreditedEvent } from "@/lib/akiba/milesEarnedNotification";
import { recordVerifiedEarningForDiscovery, type EarningChannel } from "@/lib/akiba/discoveryEarningIngestion";
import { isValidInternalApiKey } from "@/lib/akiba/internalApiAuth";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_SOURCES = new Set(["merchant_scan", "merchant_purchase"]);
const ALLOWED_CHANNELS = new Set(["in_store", "online", "unknown"]);

type RequestBody = Partial<MilesCreditedEvent>;

function validate(body: RequestBody): { ok: true; event: MilesCreditedEvent } | { ok: false; error: string } {
  if (typeof body.eventId !== "string" || body.eventId.length < 1 || body.eventId.length > 200) {
    return { ok: false, error: "invalid_event_id" };
  }
  if (typeof body.hubUserId !== "string" || !UUID_RE.test(body.hubUserId)) {
    return { ok: false, error: "invalid_hub_user_id" };
  }
  if (typeof body.merchantId !== "string" || !UUID_RE.test(body.merchantId)) {
    return { ok: false, error: "invalid_merchant_id" };
  }
  if (typeof body.merchantName !== "string" || !body.merchantName.trim()) {
    return { ok: false, error: "invalid_merchant_name" };
  }
  if (!Number.isInteger(body.milesAwarded) || (body.milesAwarded as number) <= 0) {
    return { ok: false, error: "invalid_miles_awarded" };
  }
  if (typeof body.source !== "string" || !ALLOWED_SOURCES.has(body.source)) {
    return { ok: false, error: "invalid_source" };
  }
  if (typeof body.occurredAt !== "string" || !Number.isFinite(Date.parse(body.occurredAt))) {
    return { ok: false, error: "invalid_occurred_at" };
  }
  if (body.canonicalId !== undefined && typeof body.canonicalId !== "string") {
    return { ok: false, error: "invalid_canonical_id" };
  }
  if (body.purchaseEventId !== undefined && typeof body.purchaseEventId !== "string") {
    return { ok: false, error: "invalid_purchase_event_id" };
  }
  if (body.channel !== undefined && !ALLOWED_CHANNELS.has(body.channel)) {
    return { ok: false, error: "invalid_channel" };
  }
  if (body.branchId !== undefined && (typeof body.branchId !== "string" || !UUID_RE.test(body.branchId))) {
    return { ok: false, error: "invalid_branch_id" };
  }
  if (body.paidAmountMinor !== undefined && !Number.isInteger(body.paidAmountMinor)) {
    return { ok: false, error: "invalid_paid_amount_minor" };
  }
  if (body.currency !== undefined && (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency))) {
    return { ok: false, error: "invalid_currency" };
  }
  if (body.sourceItemRef !== undefined && typeof body.sourceItemRef !== "string") {
    return { ok: false, error: "invalid_source_item_ref" };
  }

  return {
    ok: true,
    event: {
      eventId: body.eventId,
      hubUserId: body.hubUserId,
      canonicalId: body.canonicalId,
      merchantId: body.merchantId,
      merchantName: body.merchantName,
      milesAwarded: body.milesAwarded as number,
      source: body.source as MilesCreditedEvent["source"],
      occurredAt: body.occurredAt,
      purchaseEventId: body.purchaseEventId,
      channel: body.channel as MilesCreditedEvent["channel"],
      branchId: body.branchId,
      paidAmountMinor: body.paidAmountMinor,
      currency: body.currency,
      sourceItemRef: body.sourceItemRef,
    },
  };
}

// A scan proves physical presence by construction — never take the body's
// word for it either way. A purchase's channel is the producer's own
// authoritative claim (already Bearer-authenticated as a trusted caller
// above); absent that claim, default to "unknown" rather than guessing —
// "unknown" simply never qualifies for a discovery contribution request
// (§8.1) until Akiba-Platform starts supplying it (§21.4).
function resolveDiscoveryChannel(event: MilesCreditedEvent): EarningChannel {
  if (event.source === "merchant_scan") return "in_store";
  return event.channel ?? "unknown";
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const auth = request.headers.get("Authorization") ?? "";
  const callerKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!callerKey || !isValidInternalApiKey(callerKey)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: withinLimit, error: rlError } = await admin.rpc("check_rate_limit", {
    p_scope: `miles-credited:ip:${ip}`,
    p_limit: 120,
    p_window_seconds: 60,
  });
  if (rlError) {
    console.error("[miles-credited] rate limit check failed:", rlError.message);
  } else if (withinLimit === false) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const validated = validate(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const result = await produceMilesEarnedNotification(validated.event);

  // Independent of the notification outcome above (§8.1) — never lets a
  // discovery-ingestion failure affect this route's response. The function
  // itself already guards against throwing; the try/catch here is defense
  // in depth against that guarantee being removed later.
  try {
    await recordVerifiedEarningForDiscovery(validated.event, resolveDiscoveryChannel(validated.event));
  } catch (err) {
    console.error("[miles-credited] recordVerifiedEarningForDiscovery threw unexpectedly:", err);
  }

  if (!result.ok && result.skipped === "insert_failed") {
    // Retryable per the doc comment above — caller's outbox should retry.
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eventId: validated.event.eventId, notified: result.ok });
}
