// PATCH /api/admin/fulfillment/[id] — action a digital fulfilment job
// Body: { action: "deliver", provider_ref: string }
//     | { action: "fail", error: string }
//     | { action: "retry" }
//
// Ops stands in for the manual executor (order-lifecycle-completion-spec.md
// §4.2) — the RPCs handle the order_status transition + audit event.
// complete_fulfillment_job itself cascades delivered -> received -> completed
// and makes the reward job eligible, all atomically in Postgres — this route
// used to also fire an unawaited webhook to hub-page for that cascade, which
// had no retry/durability (a dead process or network blip left the order
// stuck at 'delivered' forever). Removed: the DB transaction is the durable
// path now, and reward release is picked up by hub-page's scheduled
// process-reward-jobs worker regardless of which app completed the order.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

type Body =
  | { action: "deliver"; provider_ref?: string }
  | { action: "fail"; error?: string }
  | { action: "retry" };

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("orders.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let rpcName: string;
  let rpcArgs: Record<string, unknown>;

  if (body.action === "deliver") {
    if (!body.provider_ref?.trim()) {
      return NextResponse.json({ error: "provider_ref is required" }, { status: 400 });
    }
    rpcName = "complete_fulfillment_job";
    rpcArgs = { p_job_id: params.id, p_provider_ref: body.provider_ref.trim() };
  } else if (body.action === "fail") {
    if (!body.error?.trim()) {
      return NextResponse.json({ error: "error is required" }, { status: 400 });
    }
    rpcName = "fail_fulfillment_job";
    rpcArgs = { p_job_id: params.id, p_error: body.error.trim() };
  } else if (body.action === "retry") {
    rpcName = "retry_fulfillment_job";
    rpcArgs = { p_job_id: params.id };
  } else {
    return NextResponse.json({ error: "Invalid action. Allowed: deliver | fail | retry" }, { status: 400 });
  }

  const { data: rows, error } = await supabase.rpc(rpcName, rpcArgs);
  const result = (rows as Array<{ ok: boolean; error_code: string }> | null)?.[0];

  if (error || !result?.ok) {
    return NextResponse.json({ error: result?.error_code ?? error?.message ?? "Action failed" }, { status: 500 });
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: `fulfillment_job.${body.action}`,
    targetType: "fulfillment_job",
    targetId: params.id,
    metadata: body,
  });

  return NextResponse.json({ ok: true });
}
