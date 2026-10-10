/**
 * POST /api/vouchers/grant
 *
 * Reserved for allocation-backed reimbursable voucher issuance. The Platform
 * currently rejects `internal_grant` at its authorization boundary, so this
 * endpoint must fail closed rather than falling back to the legacy
 * `issue_voucher_from_program` RPC (which does not enforce the funded-voucher
 * eligibility, availability, and reservation invariants).
 */
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { akibaFundedVouchersAdminFlag } from "@/lib/featureFlags";

export async function POST() {
  const session = await requireAdminSession("voucher_funds.grant");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!akibaFundedVouchersAdminFlag()) {
    return NextResponse.json({ error: "Voucher issuance is disabled." }, { status: 503 });
  }

  return NextResponse.json(
    {
      error: "Direct voucher issuance is not enabled by the Platform yet.",
      code: "CLAIM_MODE_NOT_ENABLED",
    },
    { status: 409, headers: { "Cache-Control": "private, no-store" } },
  );
}
