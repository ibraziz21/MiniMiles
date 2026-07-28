// PATCH /api/admin/disputes/[id] — resolve an open dispute
// Body: { resolution: "received" | "cancelled" }
//
// disputed -> received / disputed -> cancelled are both admin-only transitions
// (order_status_transitions). Cancelling reuses the same atomic refund/
// voucher-reinstatement compensation as any other cancel.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("orders.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { resolution?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.resolution !== "received" && body.resolution !== "cancelled") {
    return NextResponse.json({ error: "resolution must be received | cancelled" }, { status: 400 });
  }

  const { data: rows, error } = await supabase.rpc("advance_order_status", {
    p_order_id: params.id,
    p_to_status: body.resolution,
    p_actor: "admin",
    p_meta: { reason: "dispute_resolved" },
  });

  const result = (rows as Array<{ ok: boolean; error_code: string }> | null)?.[0];

  if (error || !result?.ok) {
    return NextResponse.json({ error: result?.error_code ?? error?.message ?? "Failed to resolve dispute" }, { status: 500 });
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: `dispute.resolved.${body.resolution}`,
    targetType: "order",
    targetId: params.id,
  });

  return NextResponse.json({ ok: true });
}
