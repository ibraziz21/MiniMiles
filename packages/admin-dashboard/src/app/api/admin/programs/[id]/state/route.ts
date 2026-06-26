/**
 * POST /api/admin/programs/[id]/state (admin-dashboard)
 * Transitions a voucher program state. Requires vouchers.write permission.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const session = await requireAdminSession("vouchers.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const adminUserId = adminIdForWrite(session);
  const actorId = adminUserId ?? "open-access";

  let newState: string | null = null;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    newState = typeof body?.state === "string" ? body.state : null;
  } else {
    const form = await req.formData().catch(() => null);
    newState = form?.get("state")?.toString() ?? null;
  }

  if (!newState) return NextResponse.json({ error: "Missing state" }, { status: 400 });

  // Pass null for merchant actor: admin calls skip the merchant_audit_log INSERT.
  // Admin audit is written separately via writeAdminAuditLog below.
  const { data, error } = await supabase.rpc("transition_program_state", {
    p_program_id:        id,
    p_new_state:         newState,
    p_merchant_user_id:  null,
    p_partner_id:        null,
  });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("INVALID_TRANSITION"))                return NextResponse.json({ error: `Invalid transition to ${newState}` }, { status: 400 });
    if (msg.includes("ACTIVATION_REQUIRES_TOTAL_CAP"))     return NextResponse.json({ error: "Set total_cap before activating" }, { status: 409 });
    if (msg.includes("ACTIVATION_REQUIRES_SETTLEMENT_TERMS")) return NextResponse.json({ error: "Configure settlement terms before activating" }, { status: 409 });
    if (msg.includes("ACTIVATION_REQUIRES_ACTIVE_CHANNEL"))return NextResponse.json({ error: "Add an active channel before activating" }, { status: 409 });
    if (msg.includes("CHANNEL_CAP_SUM_EXCEEDS_TOTAL_CAP")) return NextResponse.json({ error: "Channel cap sum exceeds total cap" }, { status: 409 });
    if (msg.includes("PROGRAM_ALREADY_ENDED"))             return NextResponse.json({ error: "Program already ended" }, { status: 409 });
    console.error("[admin/programs state]", error);
    return NextResponse.json({ error: "Transition failed" }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row?.ok) return NextResponse.json({ error: "Transition failed" }, { status: 500 });

  await writeAdminAuditLog({
    adminUserId,
    action:      "vouchers.program_state_changed",
    targetType:  "voucher_program",
    targetId:    id,
    metadata:    { new_state: newState },
  });

  // Redirect back for form submissions; JSON for API calls
  if (ct.includes("application/json")) {
    return NextResponse.json({ ok: true });
  }
  return NextResponse.redirect(new URL(`/vouchers/programs`, req.url));
}
