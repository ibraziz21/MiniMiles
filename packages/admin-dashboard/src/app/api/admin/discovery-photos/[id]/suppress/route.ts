// POST /api/admin/discovery-photos/:id/suppress
// Emergency suppression for an already-moderated (and therefore currently
// public) visit photo — verified-discovery-market-readiness-hardening-
// spec.md §7.1 "Emergency suppression quarantines or removes public
// derivatives so retained signed URLs stop working within five minutes",
// §8.3 "suppress a photo... immediately". Separate from the approve/reject
// route: this works regardless of moderation_status and does not change it,
// it only flips `suppressed_at`, which the canonical eligibility projection
// checks on every public read — no cache to wait out, no separate
// revocation step.
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REASON_LENGTH = 64;

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

function resultErrorResponse(errorCode: string | undefined) {
  if (errorCode === "rate_limited") {
    return NextResponse.json({ error: "Too many moderation actions. Wait a moment and try again." }, { status: 429 });
  }
  if (errorCode === "not_found") {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  if (errorCode === "invalid_transition") {
    return NextResponse.json({ error: "The photo is already in that state." }, { status: 409 });
  }
  if (errorCode === "reason_too_long") {
    return NextResponse.json({ error: `Reason must be ${MAX_REASON_LENGTH} characters or fewer.` }, { status: 422 });
  }
  return NextResponse.json({ error: "The photo could not be updated." }, { status: 422 });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("discovery.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!sameOrigin(req)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }

  if (!UUID_PATTERN.test(params.id)) {
    return NextResponse.json({ error: "Invalid photo ID." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { suppressed, reasonCode } = (body ?? {}) as { suppressed?: boolean; reasonCode?: string };
  if (typeof suppressed !== "boolean") {
    return NextResponse.json({ error: "Invalid request." }, { status: 422 });
  }
  if (reasonCode !== undefined && (typeof reasonCode !== "string" || reasonCode.length > MAX_REASON_LENGTH)) {
    return NextResponse.json({ error: `Reason must be ${MAX_REASON_LENGTH} characters or fewer.` }, { status: 422 });
  }

  const actorId = adminIdForWrite(session);
  if (!actorId) {
    return NextResponse.json({ error: "A named admin session is required." }, { status: 403 });
  }
  const correlationId = randomUUID();

  const { data, error } = await supabase.rpc("set_visit_photo_suppression", {
    p_photo_id: params.id,
    p_suppressed: suppressed,
    p_actor_id: actorId,
    p_correlation_id: correlationId,
    p_reason_code: reasonCode ?? null,
  });

  const result = Array.isArray(data) ? data[0] : data;
  if (error) {
    console.error("[discovery-photos/suppress] transition failed", { code: error.code, message: error.message });
    return NextResponse.json({ error: "The photo could not be updated." }, { status: 500 });
  }
  if (!result?.ok) {
    return resultErrorResponse(result?.error_code as string | undefined);
  }

  await writeAdminAuditLog({
    adminUserId: actorId,
    action: suppressed ? "discovery_photo.suppress" : "discovery_photo.unsuppress",
    targetType: "merchant_visit_photo",
    targetId: params.id,
    metadata: { reasonCode: reasonCode ?? null, correlationId },
  });

  return NextResponse.json({ ok: true, photo: result.photo });
}
