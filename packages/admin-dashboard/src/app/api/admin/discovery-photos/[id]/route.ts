// POST /api/admin/discovery-photos/:id
// Admin moderation for first-party visit photos (verified-discovery-
// acquisition-v1-spec.md §13.2, §13.3). Same atomic-transition-RPC shape as
// discovery-items/directory-reviews.
import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(["approve", "reject"]);

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

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("discovery.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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
  if (action === "reject" && (typeof reasonCode !== "string" || !reasonCode.trim())) {
    return NextResponse.json({ error: "A rejection reason is required." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("perform_visit_photo_transition", {
    p_photo_id: params.id,
    p_action: action,
    p_reason_code: action === "reject" ? reasonCode : null,
  });

  const result = Array.isArray(data) ? data[0] : data;
  if (error) return rpcErrorResponse(error);
  if (!result?.ok) {
    return NextResponse.json({ error: "The photo could not be updated." }, { status: 422 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: `discovery_photo.${action}`,
    targetType: "merchant_visit_photo",
    targetId: params.id,
    metadata: { reasonCode: reasonCode ?? null },
  });

  return NextResponse.json({ ok: true, photo: result.photo });
}
