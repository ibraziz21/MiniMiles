import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason : "manual pause";
  const actorId = adminIdForWrite(session) ?? "open-access";

  const { error } = await supabase.rpc("pause_payout_provider", {
    p_provider_name: params.name,
    p_reason: reason,
    p_actor: actorId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "payout.provider_paused",
    targetType: "payout_provider",
    targetId: params.name,
    metadata: { reason },
  });
  return NextResponse.json({ ok: true });
}
