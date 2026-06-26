import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";

export async function POST(_req: Request, { params }: { params: { name: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actorId = adminIdForWrite(session) ?? "open-access";

  const { error } = await supabase.rpc("resume_payout_provider", {
    p_provider_name: params.name,
    p_actor: actorId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "payout.provider_resumed",
    targetType: "payout_provider",
    targetId: params.name,
  });
  return NextResponse.json({ ok: true });
}
