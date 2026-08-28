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
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { produceMilesEarnedNotification, type MilesCreditedEvent } from "@/lib/akiba/milesEarnedNotification";

function validKeys(): string[] {
  const multi = (process.env.AKIBA_API_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const single = (process.env.AKIBA_API_KEY ?? "").trim();
  return multi.length > 0 ? multi : single ? [single] : [];
}

function keyMatches(candidate: string): boolean {
  const cand = Buffer.from(candidate);
  let ok = false;
  for (const key of validKeys()) {
    const buf = Buffer.from(key);
    if (buf.length === cand.length && timingSafeEqual(buf, cand)) ok = true;
  }
  return ok;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_SOURCES = new Set(["merchant_scan", "merchant_purchase"]);

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
    },
  };
}

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const auth = request.headers.get("Authorization") ?? "";
  const callerKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!callerKey || !keyMatches(callerKey)) {
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
  if (!result.ok && result.skipped === "insert_failed") {
    // Retryable per the doc comment above — caller's outbox should retry.
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, eventId: validated.event.eventId, notified: result.ok });
}
