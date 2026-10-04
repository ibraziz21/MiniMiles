import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { fundedVoucherAdminGuard, fundedVoucherActorId } from "@/lib/voucherFundsAccess";
import { writeAdminAuditLog } from "@/lib/audit";
import { transitionProgram, textOrNull, rpcErrorResponse } from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/reject — Finance returns a fund to draft with a reason.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.approve");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const fundedVoucherGuard = fundedVoucherAdminGuard(session);
  if (fundedVoucherGuard) return fundedVoucherGuard;
  const { fundId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = textOrNull(body?.reason, 2000);
  if (!reason) return NextResponse.json({ error: "A rejection reason is required." }, { status: 400 });

  const actorId = fundedVoucherActorId(session);
  const { data, error } = await transitionProgram(fundId, "reject", actorId, reason, null);
  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.rejected",
    targetType: "voucher_funding_program",
    targetId: fundId,
    metadata: { reason },
  });

  return NextResponse.json({ ok: true, data });
}
