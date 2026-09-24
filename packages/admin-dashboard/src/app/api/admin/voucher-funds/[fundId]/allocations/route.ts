import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  VOUCHER_FUND_RPCS,
  OPEN_ACCESS_ACTOR_ID,
  DISTRIBUTION_MODES,
  hasRequiredFundCountryRule,
  kesToMinor,
  textOrNull,
  positiveIntOrNull,
  rpcErrorResponse,
} from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/allocations — one allocation, one merchant, one benefit.
// See packages/admin-dashboard/docs/akiba-funded-voucher-admin-spec.md §7.2-§7.5.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fundId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const merchantId = typeof body.merchantId === "string" ? body.merchantId : null;
  const title = textOrNull(body.title, 200);
  const discountKes = typeof body.discountKes === "number" ? body.discountKes : Number(body.discountKes);
  const minimumSpendKes =
    typeof body.minimumSpendKes === "number" ? body.minimumSpendKes : Number(body.minimumSpendKes);
  const quantityCap = positiveIntOrNull(body.quantityCap);
  const voucherValidityDays = positiveIntOrNull(body.voucherValidityDays);
  const claimStartsAt = typeof body.claimStartsAt === "string" ? body.claimStartsAt : null;
  const claimEndsAt = typeof body.claimEndsAt === "string" ? body.claimEndsAt : null;

  if (!merchantId) return NextResponse.json({ error: "Select a merchant." }, { status: 400 });
  if (!title) return NextResponse.json({ error: "A customer-facing voucher title is required." }, { status: 400 });
  if (!Number.isFinite(discountKes) || discountKes <= 0) {
    return NextResponse.json({ error: "Discount value must be a positive KES amount." }, { status: 400 });
  }
  if (!Number.isFinite(minimumSpendKes) || minimumSpendKes < discountKes) {
    return NextResponse.json({ error: "Minimum purchase must be at least the discount value." }, { status: 400 });
  }
  if (!quantityCap) return NextResponse.json({ error: "Quantity must be a positive integer." }, { status: 400 });
  if (!claimStartsAt || !claimEndsAt) {
    return NextResponse.json({ error: "Claim start and end dates are required." }, { status: 400 });
  }
  if (!voucherValidityDays) {
    return NextResponse.json({ error: "Voucher validity after claim is required." }, { status: 400 });
  }

  const distributionModes = Array.isArray(body.distributionModes)
    ? body.distributionModes.filter((m): m is string =>
        (DISTRIBUTION_MODES as readonly string[]).includes(m as string),
      )
    : [];

  const authorizedBudgetMinor = body.authorizedBudgetKes == null ? null : kesToMinor(body.authorizedBudgetKes);
  const eligibilityRuleSetId = typeof body.eligibilityRuleSetId === "string" ? body.eligibilityRuleSetId : null;
  if (!eligibilityRuleSetId) {
    return NextResponse.json(
      { error: "A country-restricted eligibility rule set is required." },
      { status: 400 },
    );
  }

  const [{ data: fund }, { data: ruleSet }] = await Promise.all([
    supabase.from("voucher_funding_programs").select("country_code").eq("id", fundId).single(),
    supabase
      .from("voucher_eligibility_rule_sets")
      .select("program_id, mode, rules")
      .eq("id", eligibilityRuleSetId)
      .single(),
  ]);
  if (!fund?.country_code) {
    return NextResponse.json({ error: "Voucher fund not found." }, { status: 404 });
  }
  if (
    !ruleSet ||
    ruleSet.program_id !== fundId ||
    !hasRequiredFundCountryRule(ruleSet.mode, ruleSet.rules, fund.country_code)
  ) {
    return NextResponse.json(
      { error: `Eligibility must require all rules and restrict members to ${fund.country_code}.` },
      { status: 400 },
    );
  }

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await supabase.rpc(VOUCHER_FUND_RPCS.createAllocation, {
    p_program_id: fundId,
    p_merchant_id: merchantId,
    p_actor_id: actorId,
    p_title: title,
    p_description: textOrNull(body.description, 2000),
    p_discount_kes: discountKes,
    p_minimum_spend_kes: minimumSpendKes,
    p_terms_text: textOrNull(body.termsText, 4000),
    p_quantity_cap: quantityCap,
    p_authorized_budget_minor: authorizedBudgetMinor,
    p_claim_starts_at: claimStartsAt,
    p_claim_ends_at: claimEndsAt,
    p_voucher_validity_seconds: voucherValidityDays * 86400,
    p_distribution_modes: distributionModes.length > 0 ? distributionModes : null,
    p_recycle_expired_inventory: Boolean(body.recycleExpiredInventory),
    p_eligibility_rule_set_id: eligibilityRuleSetId,
    p_metadata: { notes: textOrNull(body.notes, 4000) },
  });

  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_allocation.created",
    targetType: "voucher_funding_allocation",
    targetId: data.id,
    metadata: { program_id: fundId, merchant_id: merchantId, quantity_cap: quantityCap, discount_kes: discountKes },
  });

  return NextResponse.json({ ok: true, data });
}
