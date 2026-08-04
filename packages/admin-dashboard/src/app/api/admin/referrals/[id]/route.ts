// PATCH /api/admin/referrals/[id]
// Body: { action: "reject", reason: string }
//
// Rejects the whole referral via admin_reject_referral
// (054_referral_admin_actions.sql) — voids every un-released reward job
// and marks the referral rejected. Kept a separate route from the
// job-scoped one because it operates on the referrals table, not
// referral_reward_jobs.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("referrals.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { action?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.action !== "reject") {
    return NextResponse.json({ error: "action must be reject" }, { status: 400 });
  }
  if (!body.reason?.trim()) {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("admin_reject_referral", {
    p_referral_id: params.id,
    p_reason: body.reason.trim(),
  });
  if (error) return NextResponse.json({ error: "Reject failed" }, { status: 500 });

  const row = (Array.isArray(data) ? data[0] : data) as { ok: boolean; voided_jobs: number } | undefined;
  if (!row?.ok) {
    return NextResponse.json({ error: "Referral not found or already complete" }, { status: 409 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "referral.rejected",
    targetType: "referral",
    targetId: params.id,
    metadata: { reason: body.reason, voidedJobs: row.voided_jobs },
  });

  return NextResponse.json({ ok: true, voidedJobs: row.voided_jobs });
}
