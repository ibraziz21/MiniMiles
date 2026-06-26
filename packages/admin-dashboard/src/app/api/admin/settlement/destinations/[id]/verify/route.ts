import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

const ELEVATED_ROLES = new Set(["super_admin", "finance_admin"]);

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!ELEVATED_ROLES.has(session.role)) {
    return NextResponse.json({ error: "Forbidden: elevated role required" }, { status: 403 });
  }

  const actorId = adminIdForWrite(session) ?? "open-access";

  const { error } = await supabase.rpc("verify_payout_destination", {
    p_destination_id: params.id,
    p_actor: actorId,
    p_actor_type: "admin",
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "destination.verified",
    targetType: "payout_destination",
    targetId: params.id,
    metadata: {},
  });

  return NextResponse.json({ ok: true, destination_id: params.id });
}
