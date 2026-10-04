import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { fundedVoucherAdminGuard, fundedVoucherActorId } from "@/lib/voucherFundsAccess";
import { writeAdminAuditLog } from "@/lib/audit";
import { transitionProgram, rpcErrorResponse } from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/submit — send a draft fund for Finance approval.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const fundedVoucherGuard = fundedVoucherAdminGuard(session);
  if (fundedVoucherGuard) return fundedVoucherGuard;
  const { fundId } = await params;

  const actorId = fundedVoucherActorId(session);
  const { data, error } = await transitionProgram(fundId, "submit", actorId, null, null);
  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.submitted",
    targetType: "voucher_funding_program",
    targetId: fundId,
  });

  return NextResponse.json({ ok: true, data });
}
