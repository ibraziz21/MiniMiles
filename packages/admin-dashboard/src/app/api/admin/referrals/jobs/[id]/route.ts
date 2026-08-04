// PATCH /api/admin/referrals/jobs/[id]
// Body: { action: "requeue" | "void" | "reverse", reason: string }
//
// Every action delegates to a 054_referral_admin_actions.sql RPC — none of
// them write to miles_ledger directly (requeue just re-arms the normal
// worker pipeline; void/reverse only touch Hub's own bookkeeping).

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

const RPC_BY_ACTION: Record<string, string> = {
  requeue: "admin_requeue_referral_reward_job",
  void: "admin_void_referral_reward_job",
  reverse: "admin_reverse_referral_reward_job",
};

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("referrals.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { action?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const rpcName = body.action ? RPC_BY_ACTION[body.action] : undefined;
  if (!rpcName) {
    return NextResponse.json({ error: "action must be requeue | void | reverse" }, { status: 400 });
  }
  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc(rpcName, { p_job_id: params.id, p_reason: body.reason.trim() });
  if (error) return NextResponse.json({ error: `${body.action} failed` }, { status: 500 });
  if (data !== true) {
    return NextResponse.json({ error: "Job is not in a state that allows this action" }, { status: 409 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: `referral.job.${body.action}`,
    targetType: "referral_reward_job",
    targetId: params.id,
    metadata: { reason: body.reason },
  });

  return NextResponse.json({ ok: true });
}
