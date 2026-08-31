// POST /api/admin/subscription-payments/[id]/confirm
// Confirms a valid NCBA/M-Pesa subscription payment. All enforceable checks live
// in the Akiba-owned `confirm_subscription_payment` RPC (migration 092), which
// locks the attempt, invoice, and subscription rows, requires an exact KES
// balance match, enforces reference uniqueness, and is idempotent on retry.
// This route validates shape, forwards the decision, reads back the resulting
// subscription effect for the success screen, and writes the admin audit row.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  DECISION_ROLES,
  decisionIdempotencyKey,
  isUuid,
  MAX_NOTE_LENGTH,
  normalizeDecimalString,
  OPEN_ACCESS_ADMIN_ID,
  RPC_ERROR_MESSAGES,
  statusForRpcError,
  SUBSCRIPTION_PAYMENT_RPCS,
  SUBSCRIPTION_PAYMENT_VIEWS,
  textOrNull,
} from "@/lib/subscriptionPayments";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!DECISION_ROLES.has(session.role)) {
    return NextResponse.json({ error: "Forbidden: finance admin role required" }, { status: 403 });
  }
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid payment attempt id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return NextResponse.json({ error: "expectedVersion (integer) is required" }, { status: 400 });
  }

  const confirmedReference = textOrNull(body.confirmedReference, 128);
  if (!confirmedReference) {
    return NextResponse.json({ error: "confirmedReference is required" }, { status: 400 });
  }

  const confirmedAmount = normalizeDecimalString(body.confirmedAmount);
  if (!confirmedAmount) {
    return NextResponse.json(
      { error: 'confirmedAmount must be a decimal string, e.g. "24000.00"' },
      { status: 400 },
    );
  }

  // Phase one is KES-only. The RPC has no currency parameter (it always compares
  // against the KES invoice balance), so this is enforced only at the boundary
  // and recorded in the audit trail.
  if (body.confirmedCurrency !== "KES") {
    return NextResponse.json({ error: "confirmedCurrency must be KES" }, { status: 400 });
  }

  const paymentDate = typeof body.paymentDate === "string" ? new Date(body.paymentDate) : null;
  if (!paymentDate || Number.isNaN(paymentDate.getTime())) {
    return NextResponse.json({ error: "paymentDate must be a valid ISO datetime" }, { status: 400 });
  }
  if (paymentDate.getTime() > Date.now() + 60_000) {
    return NextResponse.json({ error: "paymentDate cannot be in the future" }, { status: 400 });
  }

  const evidenceNote = textOrNull(body.evidenceNote, MAX_NOTE_LENGTH);
  if (!evidenceNote) {
    return NextResponse.json({ error: "evidenceNote is required" }, { status: 400 });
  }

  const allowOverride = session.role === "super_admin" && body.superAdminOverride === true;
  const adminId = adminIdForWrite(session) ?? OPEN_ACCESS_ADMIN_ID;

  const { data, error } = await supabase.rpc(SUBSCRIPTION_PAYMENT_RPCS.confirm, {
    p_attempt_id: params.id,
    p_admin_id: adminId,
    p_confirmed_amount: confirmedAmount,
    p_confirmed_reference: confirmedReference,
    p_expected_version: expectedVersion,
    p_allow_override: allowOverride,
  });

  if (error) {
    console.error("[admin/subscription-payments] confirm RPC error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    const code = row?.error_code as string | undefined;
    return NextResponse.json(
      { error: RPC_ERROR_MESSAGES[code ?? ""] ?? code ?? "Confirmation failed", code },
      { status: statusForRpcError(code) },
    );
  }

  // Read back the persisted subscription effect for the success screen (AC-14).
  const { data: effect } = await supabase
    .from(SUBSCRIPTION_PAYMENT_VIEWS.receipt)
    .select(
      "plan, billing_term, subscription_status, subscription_billing_period, term_start, term_end, next_renewal_at, usage_period_end",
    )
    .eq("payment_attempt_id", params.id)
    .maybeSingle();

  const result = {
    ok: true as const,
    idempotent: Boolean(row.idempotent),
    paymentAttemptId: params.id,
    invoiceId: row.invoice_id ?? null,
    invoiceStatus: row.invoice_status ?? null,
    receiptNumber: row.receipt_number ?? null,
    subscription: effect
      ? {
          status: effect.subscription_status ?? row.subscription_status ?? null,
          plan: effect.plan ?? null,
          billingPeriod: effect.subscription_billing_period ?? effect.billing_term ?? null,
          termStart: effect.term_start ?? null,
          termEnd: effect.term_end ?? null,
          nextRenewalAt: effect.next_renewal_at ?? null,
          usagePeriodEnd: effect.usage_period_end ?? null,
        }
      : { status: row.subscription_status ?? null },
  };

  // Audit AFTER commit. `writeAdminAuditLog` swallows its own errors — a failure
  // here must not roll back or repeat the RPC, so it is fire-and-forget.
  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "subscription_payment.confirmed",
    targetType: "subscription_payment_attempt",
    targetId: params.id,
    metadata: {
      idempotency_key: decisionIdempotencyKey(params.id, "confirm"),
      invoice_id: result.invoiceId,
      subscription_id: row.subscription_id ?? null,
      previous_state: "under_review",
      new_state: "confirmed",
      expected_version: expectedVersion,
      confirmed_amount: confirmedAmount,
      confirmed_currency: "KES",
      confirmed_reference_masked:
        "••••" + confirmedReference.slice(-4).padStart(4, "•"),
      bank_settlement_date: paymentDate.toISOString(),
      evidence_note: evidenceNote,
      receipt_number: result.receiptNumber,
      subscription_effect: result.subscription,
      super_admin_override: allowOverride,
      idempotent: result.idempotent,
      correlation_id: req.headers.get("x-request-id") ?? null,
    },
    ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
  });

  return NextResponse.json(result, {
    status: 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
