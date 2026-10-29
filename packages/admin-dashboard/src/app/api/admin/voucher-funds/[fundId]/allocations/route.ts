import { isRedemptionSchedule } from "@/lib/redemptionSchedule";
import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { fundedVoucherAdminGuard, fundedVoucherActorId } from "@/lib/voucherFundsAccess";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  VOUCHER_FUND_RPCS,
  DISTRIBUTION_MODES,
  hasRequiredFundCountryRule,
  kesToMinor,
  textOrNull,
  positiveIntOrNull,
  parseMerchantIds,
  rpcErrorResponse,
} from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/allocations — one allocation, one merchant, one benefit.
// See packages/admin-dashboard/docs/akiba-funded-voucher-admin-spec.md §7.2-§7.5.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const fundedVoucherGuard = fundedVoucherAdminGuard(session);
  if (fundedVoucherGuard) return fundedVoucherGuard;
  const { fundId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  if (body.redemptionSchedule !== undefined && !isRedemptionSchedule(body.redemptionSchedule)) {
    return NextResponse.json({ error: "Choose valid redemption days and timezone." }, { status: 400 });
  }
  if (body.redemptionSchedule) {
    const { error: scheduleError } = await supabase.rpc("validate_funded_redemption_schedule", { p_schedule: body.redemptionSchedule });
    if (scheduleError) {
      console.error("[redemption schedule] Validation unavailable or failed", scheduleError.message);
      return NextResponse.json({ error: "Redemption schedule could not be validated. Check the weekdays and timezone, or contact an administrator." }, { status: 503 });
    }
  }
  const merchantId = typeof body.merchantId === "string" ? body.merchantId : null;
  // Merchants beyond the primary where this allocation's vouchers may be
  // redeemed (BDR-006). The RPC below re-checks each one is active and in the
  // fund's country, so this only filters the obviously malformed.
  const additionalMerchantIds = parseMerchantIds(body.additionalMerchantIds ?? []);
  const title = textOrNull(body.title, 200);
  const voucherType = body.voucherType === "percent_off" ? "percent_off" : "fixed_off";
  const isPercent = voucherType === "percent_off";
  const discountKes = typeof body.discountKes === "number" ? body.discountKes : Number(body.discountKes);
  const discountPercent =
    typeof body.discountPercent === "number" ? body.discountPercent : Number(body.discountPercent);
  const maximumDiscountKes =
    typeof body.maximumDiscountKes === "number"
      ? body.maximumDiscountKes
      : Number(body.maximumDiscountKes);
  const minimumSpendKes =
    typeof body.minimumSpendKes === "number" ? body.minimumSpendKes : Number(body.minimumSpendKes);
  const quantityCap = positiveIntOrNull(body.quantityCap);
  const voucherValidityDays = positiveIntOrNull(body.voucherValidityDays);
  const claimStartsAt = typeof body.claimStartsAt === "string" ? body.claimStartsAt : null;
  const claimEndsAt = typeof body.claimEndsAt === "string" ? body.claimEndsAt : null;

  if (!merchantId) return NextResponse.json({ error: "Select a merchant." }, { status: 400 });
  if (!additionalMerchantIds) {
    return NextResponse.json(
      { error: "additionalMerchantIds must be an array of merchant IDs." },
      { status: 400 },
    );
  }
  if (!title) return NextResponse.json({ error: "A customer-facing voucher title is required." }, { status: 400 });

  // Percentage benefits are reimbursed at the realised discount, but the fund
  // has to reserve a bounded amount per voucher before the claim — so the cap
  // is mandatory, and it is what the ceiling is derived from. The till also
  // refuses an uncapped percentage outright.
  if (isPercent) {
    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
      return NextResponse.json({ error: "Discount percent must be between 0 and 100." }, { status: 400 });
    }
    if (!Number.isFinite(maximumDiscountKes) || maximumDiscountKes <= 0) {
      return NextResponse.json(
        { error: "A maximum discount (KES) is required for a percentage benefit." },
        { status: 400 },
      );
    }
    // Strictly greater, so a basket at exactly the minimum can never net to
    // zero and be rejected at the counter.
    if (!Number.isFinite(minimumSpendKes) || minimumSpendKes <= maximumDiscountKes) {
      return NextResponse.json(
        { error: "Minimum purchase must be greater than the maximum discount." },
        { status: 400 },
      );
    }
  } else {
    if (!Number.isFinite(discountKes) || discountKes <= 0) {
      return NextResponse.json({ error: "Discount value must be a positive KES amount." }, { status: 400 });
    }
    if (!Number.isFinite(minimumSpendKes) || minimumSpendKes < discountKes) {
      return NextResponse.json({ error: "Minimum purchase must be at least the discount value." }, { status: 400 });
    }
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

  const actorId = fundedVoucherActorId(session);
  const { data, error } = await supabase.rpc(VOUCHER_FUND_RPCS.createAllocationWithMerchants, {
    p_program_id: fundId,
    p_merchant_id: merchantId,
    p_additional_merchant_ids: additionalMerchantIds,
    p_actor_id: actorId,
    p_title: title,
    p_description: textOrNull(body.description, 2000),
    p_voucher_type: voucherType,
    p_discount_kes: isPercent ? null : discountKes,
    p_discount_percent: isPercent ? discountPercent : null,
    p_maximum_discount_kes: isPercent ? maximumDiscountKes : null,
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
    p_metadata: { notes: textOrNull(body.notes, 4000), redemption_schedule: body.redemptionSchedule ?? null },
  });

  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_allocation.created",
    targetType: "voucher_funding_allocation",
    targetId: data.id,
    metadata: {
      program_id: fundId,
      merchant_id: merchantId,
      quantity_cap: quantityCap,
      voucher_type: voucherType,
      additional_merchant_ids: additionalMerchantIds,
      ...(isPercent
        ? { discount_percent: discountPercent, maximum_discount_kes: maximumDiscountKes }
        : { discount_kes: discountKes }),
    },
  });

  return NextResponse.json({ ok: true, data });
}
