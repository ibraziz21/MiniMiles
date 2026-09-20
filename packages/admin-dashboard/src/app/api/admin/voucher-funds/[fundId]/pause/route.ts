import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { transitionProgram, OPEN_ACCESS_ACTOR_ID, textOrNull, rpcErrorResponse } from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/pause — stop new claims across all allocations.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.publish");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fundId } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const reason = textOrNull(body?.reason, 2000);
  const { data, error } = await transitionProgram(fundId, "pause", actorId, reason, null);
  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.paused",
    targetType: "voucher_funding_program",
    targetId: fundId,
    metadata: { reason },
  });

  return NextResponse.json({ ok: true, data });
}
