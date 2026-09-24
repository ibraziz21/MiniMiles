import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  VOUCHER_FUND_RPCS,
  OPEN_ACCESS_ACTOR_ID,
  isValidEligibilityRule,
  textOrNull,
  rpcErrorResponse,
} from "@/lib/voucherFunds";

// POST /api/admin/voucher-funds/:fundId/eligibility-rule-sets — versioned rule catalogue only,
// never arbitrary predicates. See akiba-funded-voucher-admin-spec.md §7.4.
export async function POST(req: NextRequest, { params }: { params: Promise<{ fundId: string }> }) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { fundId } = await params;

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const requestedRules = Array.isArray(body?.rules) ? body.rules : null;

  if (!requestedRules || !requestedRules.every(isValidEligibilityRule)) {
    return NextResponse.json(
      { error: "Select at least one supported eligibility rule." },
      { status: 400 },
    );
  }
  if (body?.mode === "any") {
    return NextResponse.json(
      { error: "Funded vouchers require every eligibility rule to match, including the fund country." },
      { status: 400 },
    );
  }

  const { data: fund, error: fundError } = await supabase
    .from("voucher_funding_programs")
    .select("country_code")
    .eq("id", fundId)
    .single();
  if (fundError || !fund?.country_code) {
    return NextResponse.json({ error: "Voucher fund not found." }, { status: 404 });
  }

  const countryCode = String(fund.country_code).trim().toUpperCase();
  const rules = [
    { type: "country_in", countries: [countryCode] },
    ...requestedRules.filter((rule) => (rule as { type?: unknown }).type !== "country_in"),
  ];
  const mode = "all";
  const customerCopy =
    textOrNull(body?.customerCopy, 1000) ??
    (countryCode === "KE"
      ? "Available only to Kenyan members who meet all other requirements."
      : `Available only to members in ${countryCode} who meet all other requirements.`);

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await supabase.rpc(VOUCHER_FUND_RPCS.createEligibilityRuleSet, {
    p_program_id: fundId,
    p_mode: mode,
    p_rules: rules,
    p_customer_copy: customerCopy,
    p_created_by: actorId,
  });

  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.eligibility_rule_set_created",
    targetType: "voucher_eligibility_rule_set",
    targetId: data.id,
    metadata: { program_id: fundId, mode, rule_count: rules.length, country_code: countryCode },
  });

  return NextResponse.json({ ok: true, data });
}
