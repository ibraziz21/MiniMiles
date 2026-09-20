import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  VOUCHER_FUND_RPCS,
  OPEN_ACCESS_ACTOR_ID,
  DISTRIBUTION_MODES,
  kesToMinor,
  textOrNull,
  positiveIntOrNull,
  rpcErrorResponse,
} from "@/lib/voucherFunds";

// PATCH /api/admin/voucher-allocations/:allocationId — edit a draft allocation.
// Economic fields become immutable after first issuance (§9).
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ allocationId: string }> },
) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { allocationId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.expectedVersion !== "number") {
    return NextResponse.json({ error: "expectedVersion is required" }, { status: 400 });
  }

  const distributionModes = Array.isArray(body.distributionModes)
    ? body.distributionModes.filter((m): m is string =>
        (DISTRIBUTION_MODES as readonly string[]).includes(m as string),
      )
    : null;

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await supabase.rpc(VOUCHER_FUND_RPCS.updateAllocationDraft, {
    p_allocation_id: allocationId,
    p_actor_id: actorId,
    p_expected_version: body.expectedVersion,
    p_title: textOrNull(body.title, 200),
    p_description: textOrNull(body.description, 2000),
    p_terms_text: textOrNull(body.termsText, 4000),
    p_discount_kes: body.discountKes == null ? null : Number(body.discountKes),
    p_minimum_spend_kes: body.minimumSpendKes == null ? null : Number(body.minimumSpendKes),
    p_quantity_cap: body.quantityCap == null ? null : positiveIntOrNull(body.quantityCap),
    p_authorized_budget_minor: body.authorizedBudgetKes == null ? null : kesToMinor(body.authorizedBudgetKes),
    p_claim_starts_at: typeof body.claimStartsAt === "string" ? body.claimStartsAt : null,
    p_claim_ends_at: typeof body.claimEndsAt === "string" ? body.claimEndsAt : null,
    p_voucher_validity_seconds:
      body.voucherValidityDays == null ? null : Number(body.voucherValidityDays) * 86400,
    p_distribution_modes: distributionModes && distributionModes.length > 0 ? distributionModes : null,
    p_recycle_expired_inventory:
      typeof body.recycleExpiredInventory === "boolean" ? body.recycleExpiredInventory : null,
    p_eligibility_rule_set_id:
      typeof body.eligibilityRuleSetId === "string" ? body.eligibilityRuleSetId : null,
    p_metadata: body.notes != null ? { notes: textOrNull(body.notes, 4000) } : null,
  });

  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_allocation.updated",
    targetType: "voucher_funding_allocation",
    targetId: allocationId,
    metadata: { expected_version: body.expectedVersion },
  });

  return NextResponse.json({ ok: true, data });
}
