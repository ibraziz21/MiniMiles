import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { fundedVoucherAdminGuard, fundedVoucherActorId } from "@/lib/voucherFundsAccess";
import { writeAdminAuditLog } from "@/lib/audit";
import { transitionProgram, textOrNull, rpcErrorResponse } from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/end — permanently stop new claims. Issued vouchers remain valid.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.publish");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const fundedVoucherGuard = fundedVoucherAdminGuard(session);
  if (fundedVoucherGuard) return fundedVoucherGuard;
  const { fundId } = await params;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const actorId = fundedVoucherActorId(session);
  const reason = textOrNull(body?.reason, 2000);
  const { data, error } = await transitionProgram(fundId, "end", actorId, reason, null);
  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.ended",
    targetType: "voucher_funding_program",
    targetId: fundId,
    metadata: { reason },
  });

  return NextResponse.json({ ok: true, data });
}
