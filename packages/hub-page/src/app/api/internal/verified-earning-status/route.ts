/**
 * POST /api/internal/verified-earning-status
 *
 * Durable reversal/dispute/reinstatement event for verified-discovery
 * earning evidence (verified-discovery-acquisition-v1-spec.md §10.4,
 * §11.1, §13.3, §8.5). Akiba-Platform (or an equivalent trusted internal
 * caller) must call this only after its own ledger reversal, dispute or
 * reinstatement has committed — never speculatively. A reversed/disputed
 * event makes any in-flight contribution request ineligible; a subsequent
 * `active` call (reinstatement) restores it. Idempotent on
 * `statusChangeEventId` — safe to retry.
 *
 * Authentication: Authorization: Bearer <AKIBA_API_KEY> — same
 * Hub<->Platform shared secret as /api/internal/miles-credited.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isValidInternalApiKey } from "@/lib/akiba/internalApiAuth";

const ALLOWED_STATUSES = new Set(["active", "reversed", "disputed"]);

type RequestBody = {
  eventId?: string;
  statusChangeEventId?: string;
  toStatus?: string;
  reason?: string;
};

type ApplyResult = {
  ok: boolean;
  applied: boolean;
  from_status: string | null;
  to_status: string;
};

export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  const auth = request.headers.get("Authorization") ?? "";
  const callerKey = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!callerKey || !isValidInternalApiKey(callerKey)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: withinLimit, error: rlError } = await admin.rpc("check_rate_limit", {
    p_scope: `verified-earning-status:ip:${ip}`,
    p_limit: 60,
    p_window_seconds: 60,
  });
  if (rlError) {
    console.error("[verified-earning-status] rate limit check failed:", rlError.message);
  } else if (withinLimit === false) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: RequestBody;
  try {
    body = (await request.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (typeof body.eventId !== "string" || !body.eventId.trim() || body.eventId.length > 200) {
    return NextResponse.json({ error: "invalid_event_id" }, { status: 400 });
  }
  if (
    typeof body.statusChangeEventId !== "string" ||
    !body.statusChangeEventId.trim() ||
    body.statusChangeEventId.length > 200
  ) {
    return NextResponse.json({ error: "invalid_status_change_event_id" }, { status: 400 });
  }
  if (typeof body.toStatus !== "string" || !ALLOWED_STATUSES.has(body.toStatus)) {
    return NextResponse.json({ error: "invalid_to_status" }, { status: 400 });
  }
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 500)) {
    return NextResponse.json({ error: "invalid_reason" }, { status: 400 });
  }

  const { data: earningEvent, error: lookupError } = await admin
    .from("verified_earning_events")
    .select("id")
    .eq("event_id", body.eventId)
    .maybeSingle();

  if (lookupError) {
    console.error("[verified-earning-status] earning event lookup failed:", lookupError.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
  if (!earningEvent) {
    return NextResponse.json({ error: "earning_event_not_found" }, { status: 404 });
  }

  const { data, error } = await admin.rpc("apply_verified_earning_status_change", {
    p_status_change_event_id: body.statusChangeEventId,
    p_event_id: earningEvent.id,
    p_to_status: body.toStatus,
    p_reason: body.reason ?? null,
  });

  if (error) {
    console.error("[verified-earning-status] apply_verified_earning_status_change failed:", error.message);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  const result = (Array.isArray(data) ? data[0] : data) as ApplyResult | undefined;
  if (!result?.ok) {
    return NextResponse.json({ error: "earning_event_not_found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    applied: result.applied,
    fromStatus: result.from_status,
    toStatus: result.to_status,
  });
}
