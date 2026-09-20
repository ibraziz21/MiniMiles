import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { transitionAllocation, OPEN_ACCESS_ACTOR_ID, rpcErrorResponse } from "@/lib/voucherFunds";

// POST /api/admin/voucher-allocations/:allocationId/submit
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ allocationId: string }> },
) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { allocationId } = await params;

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await transitionAllocation(allocationId, "submit", actorId, null);
  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_allocation.submitted",
    targetType: "voucher_funding_allocation",
    targetId: allocationId,
  });

  return NextResponse.json({ ok: true, data });
}
