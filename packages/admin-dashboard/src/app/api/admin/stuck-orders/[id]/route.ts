// PATCH /api/admin/stuck-orders/[id] — operator action from the "stuck
// orders" reconciliation queue.
// Body: { action: "cancel" | "complete" }
//
// "cancel" reuses the standard admin cancel path — atomic refund + voucher
// reinstatement, same as any other cancellation.
// "complete" is the escape hatch added in migration 042 for orders stuck at
// 'received': that status can only auto-advance to 'completed' via the
// hourly auto-complete sweep, so a row surfacing here means the sweep didn't
// run. Only valid from 'received' — advance_order_status itself still
// enforces every other transition rule.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("orders.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "cancel" && body.action !== "complete") {
    return NextResponse.json({ error: "action must be cancel | complete" }, { status: 400 });
  }

  const toStatus = body.action === "cancel" ? "cancelled" : "completed";

  const { data: rows, error } = await supabase.rpc("advance_order_status", {
    p_order_id: params.id,
    p_to_status: toStatus,
    p_actor: "admin",
    p_meta: { reason: "reconciliation_stuck_order_resolved" },
  });

  const result = (rows as Array<{ ok: boolean; error_code: string }> | null)?.[0];

  if (error || !result?.ok) {
    return NextResponse.json({ error: result?.error_code ?? error?.message ?? "Action failed" }, { status: 500 });
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: `stuck_order.${body.action}`,
    targetType: "order",
    targetId: params.id,
  });

  return NextResponse.json({ ok: true });
}
