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

const COUNTRY_RE = /^[A-Z]{2}$/;

// POST /api/admin/voucher-funds — create a draft voucher fund.
// See packages/admin-dashboard/docs/akiba-funded-voucher-admin-spec.md §7.1.
export async function POST(req: NextRequest) {
  const session = await requireAdminSession("voucher_funds.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const name = textOrNull(body.name, 200);
  const countryCode = typeof body.countryCode === "string" ? body.countryCode.toUpperCase() : "";
  const authorizedBudgetMinor = kesToMinor(body.authorizedBudgetKes);
  const startsAt = typeof body.startsAt === "string" ? body.startsAt : null;
  const endsAt = typeof body.endsAt === "string" ? body.endsAt : null;

  if (!name) return NextResponse.json({ error: "Fund name is required." }, { status: 400 });
  if (!COUNTRY_RE.test(countryCode)) {
    return NextResponse.json({ error: "Country must be a valid ISO 3166-1 alpha-2 code." }, { status: 400 });
  }
  if (!authorizedBudgetMinor) {
    return NextResponse.json({ error: "Authorized budget must be a positive KES amount." }, { status: 400 });
  }
  if (!startsAt || !endsAt) {
    return NextResponse.json({ error: "Start and end dates are required." }, { status: 400 });
  }

  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;
  const { data, error } = await supabase.rpc(VOUCHER_FUND_RPCS.createProgram, {
    p_name: name,
    p_sponsorship_label: textOrNull(body.sponsorshipLabel, 200) ?? "Funded by Akiba",
    p_country_code: countryCode,
    p_authorized_budget_minor: authorizedBudgetMinor,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_cost_center_reference: textOrNull(body.costCenterReference, 120),
    p_created_by: actorId,
    p_metadata: { notes: textOrNull(body.notes, 4000) },
  });

  if (error) return rpcErrorResponse(error);

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher_fund.created",
    targetType: "voucher_funding_program",
    targetId: data.id,
    metadata: { name, country_code: countryCode, authorized_budget_minor: authorizedBudgetMinor },
  });

  return NextResponse.json({ ok: true, data });
}
