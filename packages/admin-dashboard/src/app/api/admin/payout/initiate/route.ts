import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { executePayoutInstruction } from "@/lib/payout/execute";

export async function POST(req: NextRequest) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.batch_id !== "string" || typeof body.destination_id !== "string") {
    return NextResponse.json({ error: "batch_id and destination_id are required" }, { status: 400 });
  }
  const actorId = adminIdForWrite(session) ?? "open-access";

  const { data, error } = await supabase.rpc("create_payout_instruction", {
    p_batch_id: body.batch_id,
    p_destination_id: body.destination_id,
    p_actor: actorId,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return NextResponse.json({ error: row?.error_code ?? "CREATE_FAILED" }, { status: 409 });
  }
  const instructionId = row.instruction_id as string;

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "payout.initiated",
    targetType: "payout_instruction",
    targetId: instructionId,
    metadata: { batch_id: body.batch_id, destination_id: body.destination_id },
  });

  if (row.requires_secondary_approval) {
    return NextResponse.json(
      { ok: true, requires_secondary_approval: true, instruction_id: instructionId },
      { status: 202 },
    );
  }

  const exec = await executePayoutInstruction(instructionId, actorId);
  return NextResponse.json({
    ok: exec.ok,
    instruction_id: instructionId,
    provider_reference: exec.providerReference ?? null,
    status: exec.status ?? null,
    error: exec.error ?? null,
  });
}
