// PATCH /api/admin/referrals/risk-flags/[id] — resolve (deactivate) a flag.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { writeAdminAuditLog } from "@/lib/audit";

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("referrals.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: existing } = await supabase
    .from("hub_user_risk_flags")
    .select("id, is_active")
    .eq("id", params.id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Flag not found" }, { status: 404 });
  if (!existing.is_active) return NextResponse.json({ error: "Flag already resolved" }, { status: 409 });

  const { error } = await supabase
    .from("hub_user_risk_flags")
    .update({
      is_active: false,
      resolved_by: adminIdForWrite(session),
      resolved_at: new Date().toISOString(),
    })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: "Failed to resolve flag" }, { status: 500 });

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "referral.risk_flag.resolved",
    targetType: "hub_user_risk_flag",
    targetId: params.id,
  });

  return NextResponse.json({ ok: true });
}
