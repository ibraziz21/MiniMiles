// POST /api/admin/subscription-payments/[id]/reject
// Rejects an invalid, duplicate, mismatched, or unreadable submission through
// the Akiba-owned `reject_subscription_payment` RPC (migration 092). Only the
// attempt moves to `rejected`; the invoice returns to issued/overdue and the
// merchant can resubmit. Never activates or changes a plan.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  DECISION_ROLES,
  isUuid,
  MAX_MERCHANT_MESSAGE_LENGTH,
  MAX_NOTE_LENGTH,
  OPEN_ACCESS_ADMIN_ID,
  REJECTION_CODES,
  RPC_ERROR_MESSAGES,
  statusForRpcError,
  SUBSCRIPTION_PAYMENT_RPCS,
  textOrNull,
  type RejectionCode,
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

  const rejectionCode = body.rejectionCode as RejectionCode;
  if (!REJECTION_CODES.includes(rejectionCode)) {
    return NextResponse.json(
      { error: `rejectionCode must be one of: ${REJECTION_CODES.join(", ")}` },
      { status: 400 },
    );
  }

  const merchantMessage = textOrNull(body.merchantMessage, MAX_MERCHANT_MESSAGE_LENGTH);
  if (!merchantMessage) {
    return NextResponse.json({ error: "merchantMessage is required" }, { status: 400 });
  }

  const internalNote = textOrNull(body.internalNote, MAX_NOTE_LENGTH);
  if (rejectionCode === "other" && !internalNote) {
    return NextResponse.json(
      { error: 'internalNote is required when rejectionCode is "other"' },
      { status: 400 },
    );
  }

  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return NextResponse.json({ error: "expectedVersion (integer) is required" }, { status: 400 });
  }

  const allowOverride = session.role === "super_admin" && body.superAdminOverride === true;
  const adminId = adminIdForWrite(session) ?? OPEN_ACCESS_ADMIN_ID;

  const { data, error } = await supabase.rpc(SUBSCRIPTION_PAYMENT_RPCS.reject, {
    p_attempt_id: params.id,
    p_admin_id: adminId,
    p_rejection_code: rejectionCode,
    p_rejection_message: merchantMessage,
    p_expected_version: expectedVersion,
    p_allow_override: allowOverride,
  });

  if (error) {
    console.error("[admin/subscription-payments] reject RPC error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    const code = row?.error_code as string | undefined;
    return NextResponse.json(
      { error: RPC_ERROR_MESSAGES[code ?? ""] ?? code ?? "Rejection failed", code },
      { status: statusForRpcError(code) },
    );
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "subscription_payment.rejected",
    targetType: "subscription_payment_attempt",
    targetId: params.id,
    metadata: {
      invoice_id: row.invoice_id ?? null,
      previous_state: "under_review",
      new_state: "rejected",
      expected_version: expectedVersion,
      rejection_code: rejectionCode,
      internal_note: internalNote,
      invoice_status: row.invoice_status ?? null,
      super_admin_override: allowOverride,
      correlation_id: req.headers.get("x-request-id") ?? null,
    },
    ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    paymentAttemptId: params.id,
    invoiceId: row.invoice_id ?? null,
    invoiceStatus: row.invoice_status ?? null,
    rejectionCode,
  });
}
