/**
 * POST /api/vouchers/grant
 *
 * Allocation-backed reimbursable voucher issuance. This route resolves the
 * public username server-side and invokes the Platform's atomic funded claim
 * RPC in `internal_grant` mode. Eligibility, quantity, budget, identity, and
 * idempotency are all rechecked transactionally by that RPC.
 */
import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { isTrustedMutationRequest } from "@/lib/requestSecurity";
import { supabase } from "@/lib/supabase";
import { fundedVoucherAdminGuard, fundedVoucherActorId } from "@/lib/voucherFundsAccess";
import { resolveVoucherRecipientUsername, USERNAME_ERROR_MESSAGES } from "@/lib/voucherUsername";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ERROR_MESSAGES: Record<string, string> = {
  ALREADY_CLAIMED: "This member already has a voucher from this allocation.",
  ALLOCATION_NOT_CLAIMABLE: "This allocation is not currently open for issuance.",
  PROGRAM_NOT_LIVE: "The parent voucher fund is not currently live.",
  DISTRIBUTION_MODE_NOT_SUPPORTED: "This allocation does not allow direct issuance.",
  ELIGIBILITY_REQUIREMENTS_NOT_MET: "The member no longer meets every eligibility requirement.",
  ELIGIBILITY_POLICY_UNAVAILABLE: "The allocation's eligibility policy is unavailable.",
  COUNTRY_PROFILE_REQUIRED: "The member must set a valid profile country before receiving this voucher.",
  COUNTRY_NOT_ELIGIBLE: "The member's profile country does not match this voucher fund.",
  USERNAME_REQUIRED: "The member needs an active Akiba username.",
  HUB_IDENTITY_LINK_REQUIRED: "The member's Hub identity is incomplete.",
  QUANTITY_EXHAUSTED: "This allocation has no voucher quantity remaining.",
  BUDGET_EXHAUSTED: "This allocation or its parent fund has no reimbursable budget remaining.",
  MERCHANT_NOT_ELIGIBLE: "The merchant is not currently available for reimbursable vouchers.",
  CLAIM_MODE_NOT_ENABLED: "Direct issuance is not enabled on the voucher service yet.",
  IDEMPOTENCY_CONFLICT: "This confirmation reference was already used for a different member.",
};

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  }
  const session = await requireAdminSession("voucher_funds.grant");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const guard = fundedVoucherAdminGuard(session);
  if (guard) return guard;

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const allocationId = typeof body?.allocation_id === "string" ? body.allocation_id : "";
  const memberUsername = typeof body?.member_username === "string" ? body.member_username.trim() : "";
  const operatorReason = typeof body?.operator_reason === "string" ? body.operator_reason.trim().slice(0, 500) : "";
  const confirmationId = typeof body?.confirmation_id === "string" ? body.confirmation_id : "";
  if (!UUID.test(allocationId) || !UUID.test(confirmationId) || !/^[a-z0-9_]{3,20}$/i.test(memberUsername)) {
    return NextResponse.json({ error: "Select a valid member and allocation." }, { status: 400 });
  }
  if (operatorReason.length < 4) {
    return NextResponse.json({ error: "An operator reason of at least four characters is required." }, { status: 400 });
  }

  const member = await resolveVoucherRecipientUsername(memberUsername);
  if (!member.ok) {
    return NextResponse.json({ error: USERNAME_ERROR_MESSAGES[member.errorCode], code: member.errorCode }, { status: 422 });
  }

  const idempotencyKey = `admin-grant:${allocationId}:${member.canonicalId}:${confirmationId}`;
  const actorId = fundedVoucherActorId(session);
  const [{ data, error }, { data: allocation }] = await Promise.all([
    supabase.rpc("claim_akiba_funded_voucher_atomic", {
      p_allocation_id: allocationId,
      p_canonical_id: member.canonicalId,
      p_claim_mode: "internal_grant",
      p_idempotency_key: idempotencyKey,
      p_hub_user_id: member.hubUserId,
      p_user_address: null,
      p_rule_set_id: null,
      p_rule_set_version: null,
      p_eligibility_snapshot: {},
      p_evidence_refs: {},
      p_country_code: null,
      p_country_assurance: null,
      p_actor_type: "internal_user",
      p_actor_id: actorId,
    }),
    supabase
      .from("voucher_funding_allocations")
      .select("program_id, partners!voucher_funding_allocations_merchant_id_fkey(name), voucher_funding_programs(name)")
      .eq("id", allocationId)
      .maybeSingle(),
  ]);

  if (error) {
    console.error("[voucher-grants:issue]", error.message);
    return NextResponse.json({ error: "The voucher service could not complete issuance." }, { status: 502 });
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.ok) {
    const code = result?.error_code ?? "GRANT_FAILED";
    return NextResponse.json({ error: ERROR_MESSAGES[code] ?? "The voucher could not be issued.", code }, { status: 409 });
  }

  await writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "voucher.issue.succeeded",
    targetType: "issued_voucher",
    targetId: result.voucher_id,
    metadata: {
      allocation_id: allocationId,
      canonical_id: member.canonicalId,
      username: member.username,
      operator_reason: operatorReason,
      confirmation_id: confirmationId,
      idempotent: Boolean(result.idempotent),
    },
  });

  const related = allocation as unknown as {
    program_id: string;
    partners: { name: string } | null;
    voucher_funding_programs: { name: string } | null;
  } | null;
  return NextResponse.json({
    voucher: {
      id: result.voucher_id,
      claimId: result.claim_id,
      status: result.voucher_status,
      expiresAt: result.expires_at,
      idempotent: Boolean(result.idempotent),
      recipient: member.username,
      merchantName: related?.partners?.name ?? "Merchant",
      fundName: related?.voucher_funding_programs?.name ?? "Voucher fund",
      fundId: related?.program_id ?? null,
      auditReference: `voucher.issue:${result.voucher_id}`,
    },
  }, {
    status: result.idempotent ? 200 : 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}
