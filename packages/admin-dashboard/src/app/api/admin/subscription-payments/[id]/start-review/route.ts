// POST /api/admin/subscription-payments/[id]/start-review
// Atomically claims a `submitted` attempt for the acting finance administrator
// via the Akiba-owned `start_subscription_payment_review` RPC (migration 096).
// Concurrent claims produce one winner; the loser gets ALREADY_CLAIMED (409).

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  DECISION_ROLES,
  isUuid,
  OPEN_ACCESS_ADMIN_ID,
  RPC_ERROR_MESSAGES,
  statusForRpcError,
  SUBSCRIPTION_PAYMENT_RPCS,
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
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return NextResponse.json({ error: "expectedVersion (integer) is required" }, { status: 400 });
  }

  const adminId = adminIdForWrite(session) ?? OPEN_ACCESS_ADMIN_ID;

  const { data, error } = await supabase.rpc(SUBSCRIPTION_PAYMENT_RPCS.startReview, {
    p_attempt_id: params.id,
    p_admin_id: adminId,
    p_expected_version: expectedVersion,
  });

  if (error) {
    console.error("[admin/subscription-payments] start-review RPC error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    const code = row?.error_code as string | undefined;
    return NextResponse.json(
      { error: RPC_ERROR_MESSAGES[code ?? ""] ?? code ?? "Could not claim this attempt", code },
      { status: statusForRpcError(code) },
    );
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "subscription_payment.review_started",
    targetType: "subscription_payment_attempt",
    targetId: params.id,
    metadata: {
      previous_state: "submitted",
      new_state: "under_review",
      expected_version: expectedVersion,
      new_version: row.version ?? null,
      invoice_id: row.invoice_id ?? null,
      partner_id: row.partner_id ?? null,
    },
    ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
  });

  return NextResponse.json({ ok: true, attempt: row });
}
