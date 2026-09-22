import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  VOUCHER_FUND_RPCS,
  OPEN_ACCESS_ACTOR_ID,
  kesToMinor,
  textOrNull,
  rpcErrorResponse,
} from "@/lib/voucherFunds";

// PATCH /api/admin/voucher-funds/:fundId — edit a draft fund.
// See packages/admin-dashboard/docs/akiba-funded-voucher-admin-spec.md §9.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fundId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion is required" }, { status: 400 });
  }

  const authorizedBudgetMinor =
    body.authorizedBudgetKes == null ? null : kesToMinor(body.authorizedBudgetKes);
  if (body.authorizedBudgetKes != null && authorizedBudgetMinor == null) {
    return NextResponse.json({ error: "Authorized budget must be a positive KES amount." }, { status: 400 });
  }

  const { data, error } = await supabase.rpc(VOUCHER_FUND_RPCS.updateProgramDraft, {
    p_program_id: fundId,
    p_actor_id: adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID,
    p_expected_version: body.expectedVersion,
    p_name: textOrNull(body.name, 200),
    p_sponsorship_label: textOrNull(body.sponsorshipLabel, 200),
    p_authorized_budget_minor: authorizedBudgetMinor,
    p_starts_at: typeof body.startsAt === "string" ? body.startsAt : null,
    p_ends_at: typeof body.endsAt === "string" ? body.endsAt : null,
    p_cost_center_reference: textOrNull(body.costCenterReference, 120),
    p_metadata: body.notes != null ? { notes: textOrNull(body.notes, 4000) } : null,
  });

  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.updated",
    targetType: "voucher_funding_program",
    targetId: fundId,
    metadata: { expected_version: body.expectedVersion },
  });

  return NextResponse.json({ ok: true, data });
}
