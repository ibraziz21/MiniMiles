import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  transitionAllocation,
  describeUnreadyMerchants,
  VOUCHER_FUND_RPCS,
  OPEN_ACCESS_ACTOR_ID,
  rpcErrorResponse,
  type MerchantReadiness,
} from "@/lib/voucherFunds";

// POST /api/admin/voucher-allocations/:allocationId/publish — makes the paired
// voucher template visible to discovery/claim. Fails closed if the parent fund
// is not live (§16.2).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ allocationId: string }> },
) {
  const session = await requireAdminSession("voucher_funds.publish");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { allocationId } = await params;

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await transitionAllocation(allocationId, "publish", actorId, null);
  if (error) {
    // The database refuses an unready publish; re-read the structured rows so
    // the operator gets merchant names and reasons rather than a raw Postgres
    // message. If that read fails we still surface the original error.
    if ((error.message ?? "").includes("MERCHANT_NOT_READY")) {
      const { data: readiness } = await supabase.rpc(
        VOUCHER_FUND_RPCS.allocationMerchantReadiness,
        { p_allocation_id: allocationId },
      );
      const described = describeUnreadyMerchants((readiness ?? []) as MerchantReadiness[]);
      return NextResponse.json(
        {
          error:
            described
              ? `Cannot publish — these merchants cannot honour this offer yet. ${described}`
              : "Cannot publish — a participating merchant cannot honour this offer yet.",
          merchants: readiness ?? [],
        },
        { status: 409 },
      );
    }
    return rpcErrorResponse(error);
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_allocation.published",
    targetType: "voucher_funding_allocation",
    targetId: allocationId,
  });

  return NextResponse.json({ ok: true, data });
}
