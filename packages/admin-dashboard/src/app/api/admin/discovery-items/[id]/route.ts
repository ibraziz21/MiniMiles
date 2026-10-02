// POST /api/admin/discovery-items/:id
// Admin moderation for customer-generated discovery-item candidates
// (verified-discovery-acquisition-v1-spec.md §9.3, §13.3). Same
// atomic-transition-RPC shape as /api/admin/directory-reviews/:id —
// guarded, row-locked Postgres function, actor-agnostic audit logging
// after a successful call.
import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ACTIONS = new Set(["qualify", "suppress", "merge_into"]);

function rpcErrorResponse(error: { code?: string; message?: string }) {
  if (error.code === "P0002") {
    return NextResponse.json({ error: "Item not found." }, { status: 404 });
  }
  if (error.code === "22023") {
    return NextResponse.json({ error: "This item is already merged or suppressed." }, { status: 409 });
  }
  console.error("[discovery-items] transition failed", { code: error.code, message: error.message });
  return NextResponse.json({ error: "The item could not be updated." }, { status: 500 });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("discovery.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!UUID_PATTERN.test(params.id)) {
    return NextResponse.json({ error: "Invalid item ID." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const { action, mergeIntoItemId } = (body ?? {}) as { action?: string; mergeIntoItemId?: string };
  if (typeof action !== "string" || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Invalid action." }, { status: 422 });
  }
  if (action === "merge_into" && (typeof mergeIntoItemId !== "string" || !UUID_PATTERN.test(mergeIntoItemId))) {
    return NextResponse.json({ error: "A valid merge target item ID is required." }, { status: 422 });
  }

  const { data, error } = await supabase.rpc("perform_discovery_item_transition", {
    p_item_id: params.id,
    p_action: action,
    p_merge_into_item_id: action === "merge_into" ? mergeIntoItemId : null,
  });

  const result = Array.isArray(data) ? data[0] : data;
  if (error) return rpcErrorResponse(error);
  if (!result?.ok) {
    const code = result?.error_code as string | undefined;
    const message =
      code === "invalid_merge_target"
        ? "Choose a valid merge target."
        : code === "merge_target_not_found"
          ? "The merge target item was not found for this merchant."
          : "The item could not be updated.";
    return NextResponse.json({ error: message }, { status: 422 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: `discovery_item.${action}`,
    targetType: "merchant_discovery_item",
    targetId: params.id,
    metadata: { mergeIntoItemId: mergeIntoItemId ?? null },
  });

  return NextResponse.json({ ok: true, item: result.item });
}
