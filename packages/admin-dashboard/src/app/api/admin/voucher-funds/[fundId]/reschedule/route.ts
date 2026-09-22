import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { OPEN_ACCESS_ACTOR_ID, textOrNull, rpcErrorResponse } from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/reschedule — correct an approved/
// scheduled/active/paused fund's start/end dates without dropping it back to
// draft or losing its Finance approval. Draft funds should use PATCH instead.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.publish");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fundId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const startsAt = typeof body?.startsAt === "string" ? body.startsAt : null;
  const endsAt = typeof body?.endsAt === "string" ? body.endsAt : null;
  const reason = textOrNull(body?.reason, 2000);
  if (typeof body?.expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion is required" }, { status: 400 });
  }
  if (!startsAt || !endsAt) {
    return NextResponse.json({ error: "Start and end dates are required." }, { status: 400 });
  }
  if (!reason || reason.length < 4) {
    return NextResponse.json({ error: "A reason of at least 4 characters is required to reschedule." }, { status: 400 });
  }

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await supabase.rpc("reschedule_voucher_funding_program_atomic", {
    p_program_id: fundId,
    p_actor_id: actorId,
    p_expected_version: body.expectedVersion,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_reason: reason,
  });

  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.rescheduled",
    targetType: "voucher_funding_program",
    targetId: fundId,
    metadata: { starts_at: startsAt, ends_at: endsAt, reason },
  });

  return NextResponse.json({ ok: true, data });
}
