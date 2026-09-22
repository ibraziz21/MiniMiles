import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { transitionProgram, OPEN_ACCESS_ACTOR_ID, rpcErrorResponse } from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/publish — schedule/activate an approved fund.
// Publication is atomic and fails closed if the approval revision has moved (§7.7).
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.publish");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fundId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (typeof body?.expectedRevision !== "number") {
    return NextResponse.json({ error: "expectedRevision is required" }, { status: 400 });
  }

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await transitionProgram(fundId, "publish", actorId, null, body.expectedRevision);
  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.published",
    targetType: "voucher_funding_program",
    targetId: fundId,
  });

  return NextResponse.json({ ok: true, data });
}
