import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { executePayoutInstruction } from "@/lib/payout/execute";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const actorId = adminIdForWrite(session) ?? "open-access";
  const instructionId = params.id;

  const { data, error } = await supabase.rpc("provide_secondary_approval", {
    p_instruction_id: instructionId,
    p_actor: actorId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return NextResponse.json({ error: "APPROVAL_FAILED" }, { status: 409 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "payout.secondary_approved",
    targetType: "payout_instruction",
    targetId: instructionId,
  });

  const exec = await executePayoutInstruction(instructionId, actorId);
  return NextResponse.json({
    ok: exec.ok,
    instruction_id: instructionId,
    provider_reference: exec.providerReference ?? null,
    status: exec.status ?? null,
    error: exec.error ?? null,
  });
}
