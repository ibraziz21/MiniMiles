import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import { OPEN_ACCESS_ACTOR_ID, textOrNull } from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/vouchers/:voucherId/revoke — pre-redemption
// revocation, restricted to fraud/error/legal cases (§10 Danger zone, §9.3).
// Never available after redemption — the RPC itself rejects that case.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ fundId: string; voucherId: string }> },
) {
  const session = await requireAdminSession("voucher_funds.publish");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fundId, voucherId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = textOrNull(body?.reason, 2000);
  if (!reason || reason.length < 4) {
    return NextResponse.json({ error: "A reason of at least 4 characters is required to revoke." }, { status: 400 });
  }

  const { data: voucher } = await supabase
    .from("issued_vouchers")
    .select("id, funding_allocation_id, voucher_funding_allocations(program_id)")
    .eq("id", voucherId)
    .single();
  const allocation = voucher?.voucher_funding_allocations as unknown as { program_id: string } | null;
  if (!voucher || allocation?.program_id !== fundId) {
    return NextResponse.json({ error: "Voucher not found." }, { status: 404 });
  }

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await supabase.rpc("revoke_akiba_funded_voucher_atomic", {
    p_issued_voucher_id: voucherId,
    p_actor_id: actorId,
    p_reason: reason,
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    return NextResponse.json({ error: row?.error_code ?? "This voucher can no longer be revoked." }, { status: 409 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher.revoked",
    targetType: "issued_voucher",
    targetId: voucherId,
    metadata: { reason, fund_id: fundId },
  });

  return NextResponse.json({ ok: true, data: row });
}
