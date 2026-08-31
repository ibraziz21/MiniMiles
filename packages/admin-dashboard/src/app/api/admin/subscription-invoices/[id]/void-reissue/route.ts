// POST /api/admin/subscription-invoices/[id]/void-reissue
// Exceptional correction for an incorrect subscription invoice. Super-admin only
// in phase one. Calls the Akiba-owned `void_reissue_subscription_invoice` RPC
// (migration 096); the original invoice and its attempts remain in history.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  isUuid,
  MAX_NOTE_LENGTH,
  OPEN_ACCESS_ADMIN_ID,
  RPC_ERROR_MESSAGES,
  statusForRpcError,
  SUBSCRIPTION_PAYMENT_RPCS,
  textOrNull,
} from "@/lib/subscriptionPayments";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.write");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.role !== "super_admin") {
    return NextResponse.json({ error: "Forbidden: super admin required" }, { status: 403 });
  }
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid invoice id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = textOrNull(body?.reason, MAX_NOTE_LENGTH);
  if (!reason) {
    return NextResponse.json({ error: "A reason is required" }, { status: 400 });
  }
  const reissue = body?.reissue !== false; // default: void and reissue

  const adminId = adminIdForWrite(session) ?? OPEN_ACCESS_ADMIN_ID;

  const { data, error } = await supabase.rpc(SUBSCRIPTION_PAYMENT_RPCS.voidReissueInvoice, {
    p_invoice_id: params.id,
    p_admin_id: adminId,
    p_reason: reason,
    p_reissue: reissue,
  });

  if (error) {
    console.error("[admin/subscription-invoices] void-reissue RPC error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    const code = row?.error_code as string | undefined;
    return NextResponse.json(
      { error: RPC_ERROR_MESSAGES[code ?? ""] ?? code ?? "Void/reissue failed", code },
      { status: statusForRpcError(code) },
    );
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "subscription_invoice.voided_reissued",
    targetType: "subscription_invoice",
    targetId: params.id,
    metadata: {
      reason,
      reissued: reissue,
      replacement_invoice_id: row.replacement_invoice_id ?? null,
      partner_id: row.partner_id ?? null,
      correlation_id: req.headers.get("x-request-id") ?? null,
    },
    ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
  });

  return NextResponse.json({
    ok: true,
    invoiceId: params.id,
    replacementInvoiceId: row.replacement_invoice_id ?? null,
  });
}
