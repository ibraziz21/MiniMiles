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
import { recordVerifiedEarningForDiscovery } from "@/lib/akiba/discoveryEarningIngestion";
import { isValidInternalApiKey } from "@/lib/akiba/internalApiAuth";
import { loadPurchaseEvidence } from "@/lib/akiba/purchaseEarningChannel";

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
  // Malformed is a permanent 400, never a silent "no purchase": a producer
  // that sends one has a bug the outbox should surface, not retry around.
  if (body.purchaseEventId !== undefined && (typeof body.purchaseEventId !== "string" || !UUID_RE.test(body.purchaseEventId))) {
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

// Ownership and channel both come from purchase_visit_evidence
// (Akiba-Platform 172), the rule every reader shares; see
// lib/akiba/purchaseEarningChannel.ts.
//
// Producers: Akiba-Platform's notification worker is the only live one and
// always sends purchaseEventId. An event without one (an older producer) is
// still notified — it was Bearer-authenticated as a trusted producer — but it
// is never purchase-backed, so it can't open a verified visit.

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

  const event = validated.event;

  if (event.purchaseEventId) {
    let evidence;
    try {
      evidence = await loadPurchaseEvidence(event.purchaseEventId, event.hubUserId, event.merchantId);
    } catch (err) {
      // Transient: nothing sent, and a 500 so the producer's outbox retries.
      console.error("[miles-credited] purchase evidence lookup failed:", err);
      return NextResponse.json({ error: "purchase_lookup_failed" }, { status: 500 });
    }
    if (!evidence.owned) {
      // Permanent: the purchase doesn't exist, belongs to another merchant or
      // member, or the member has no identity to check it against. Answered
      // 200 so the producer stops retrying; nothing is sent.
      console.warn("[miles-credited] not sent:", evidence.ownership, event.eventId);
      return NextResponse.json({ ok: true, eventId: event.eventId, notified: false, skipped: evidence.ownership });
    }

    const result = await produceMilesEarnedNotification(event);
    // Independent of the notification outcome (§8.1); a discovery failure
    // never affects this response.
    try {
      await recordVerifiedEarningForDiscovery(event, evidence.channel);
    } catch (err) {
      console.error("[miles-credited] recordVerifiedEarningForDiscovery threw unexpectedly:", err);
    }
    if (!result.ok && result.skipped === "insert_failed") {
      return NextResponse.json({ error: "insert_failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, eventId: event.eventId, notified: result.ok });
  }

  // Legacy event, no purchase: notification only, never a verified visit.
  const result = await produceMilesEarnedNotification(event);
  if (!result.ok && result.skipped === "insert_failed") {
    // Retryable per the doc comment above — caller's outbox should retry.
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eventId: validated.event.eventId, notified: result.ok });
}
