// POST /api/admin/discovery-photos/:id
// Admin moderation for first-party visit photos (verified-discovery-
// acquisition-v1-spec.md §13.2, §13.3; hardened per
// verified-discovery-market-readiness-hardening-spec.md §5.6: same-origin
// validation, an enum rejection reason instead of free text, and an actor
// id + request correlation id passed through to the atomic transition RPC
// so its domain audit event — the authoritative record, not this route's
// best-effort admin_audit_logs copy — can attribute and correlate it).
import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { isDiscoveryPhotoRejectionReason } from "@/lib/discoveryModeration";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(["approve", "reject"]);

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(req.url).origin;
  } catch {
    return false;
  }
}

function rpcErrorResponse(error: { code?: string; message?: string }) {
  if (error.code === "P0002") {
    return NextResponse.json({ error: "Photo not found." }, { status: 404 });
  }
  if (error.code === "22023") {
    return NextResponse.json({ error: "This photo has already been moderated." }, { status: 409 });
  }
  console.error("[discovery-photos] transition failed", { code: error.code, message: error.message });
  return NextResponse.json({ error: "The photo could not be updated." }, { status: 500 });
}

function resultErrorResponse(errorCode: string | undefined) {
  if (errorCode === "rate_limited") {
    return NextResponse.json({ error: "Too many moderation actions. Wait a moment and try again." }, { status: 429 });
  }
  if (errorCode === "reason_required") {
    return NextResponse.json({ error: "Choose a valid rejection reason." }, { status: 422 });
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

  const { action, reasonCode } = (body ?? {}) as { action?: string; reasonCode?: string };
  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 422 });
  }
  if (action === "reject" && !isDiscoveryPhotoRejectionReason(reasonCode)) {
    return NextResponse.json({ error: "Choose a valid rejection reason." }, { status: 422 });
  }

  const actorId = adminIdForWrite(session);
  const correlationId = randomUUID();

  const { data, error } = await supabase.rpc("perform_visit_photo_transition", {
    p_photo_id: params.id,
    p_action: action,
    p_reason_code: action === "reject" ? reasonCode : null,
    p_actor_id: actorId,
    p_correlation_id: correlationId,
  });

  const result = Array.isArray(data) ? data[0] : data;
  if (error) return rpcErrorResponse(error);
  if (!result?.ok) {
    return resultErrorResponse(result?.error_code as string | undefined);
  }

  // Best-effort copy for unified cross-domain search — the RPC above
  // already wrote the authoritative, immutable domain audit event
  // (discovery_moderation_audit_events) in the same transaction as the
  // state change, keyed by this same correlationId.
  await writeAdminAuditLog({
    adminUserId: actorId,
    action: `discovery_photo.${action}`,
    targetType: "merchant_visit_photo",
    targetId: params.id,
    metadata: { reasonCode: reasonCode ?? null, correlationId },
  });

  return NextResponse.json({ ok: true, photo: result.photo });
}
