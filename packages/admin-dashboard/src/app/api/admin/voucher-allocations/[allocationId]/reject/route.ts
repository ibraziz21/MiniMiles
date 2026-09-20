import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { transitionAllocation, OPEN_ACCESS_ACTOR_ID, textOrNull, rpcErrorResponse } from "@/lib/voucherFunds";

// POST /api/admin/voucher-allocations/:allocationId/reject
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ allocationId: string }> },
) {
  const session = await requireAdminSession("voucher_funds.approve");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { allocationId } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = textOrNull(body?.reason, 2000);
  if (!reason) return NextResponse.json({ error: "A rejection reason is required." }, { status: 400 });

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await transitionAllocation(allocationId, "reject", actorId, reason);
  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_allocation.rejected",
    targetType: "voucher_funding_allocation",
    targetId: allocationId,
    metadata: { reason },
  });

  return NextResponse.json({ ok: true, data });
}
