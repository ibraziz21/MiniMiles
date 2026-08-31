// POST /api/admin/subscription-payments/[id]/take-over
// Takes over a stale claim (idle >= 30 minutes) from another reviewer through
// the Akiba-owned `take_over_subscription_payment_review` RPC (migration 096).
// A reason is mandatory and a dedicated audit event is written.

import { NextResponse } from "next/server";
import { adminIdForWrite, requireAdminSession } from "@/lib/auth";
import { writeAdminAuditLog } from "@/lib/audit";
import { supabase } from "@/lib/supabase";
import {
  DECISION_ROLES,
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
  if (!DECISION_ROLES.has(session.role)) {
    return NextResponse.json({ error: "Forbidden: finance admin role required" }, { status: 403 });
  }
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid payment attempt id" }, { status: 400 });
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const reason = textOrNull(body?.reason, MAX_NOTE_LENGTH);
  const expectedVersion = Number(body?.expectedVersion);
  if (!reason) {
    return NextResponse.json({ error: "A takeover reason is required" }, { status: 400 });
  }
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    return NextResponse.json({ error: "expectedVersion (integer) is required" }, { status: 400 });
  }

  const adminId = adminIdForWrite(session) ?? OPEN_ACCESS_ADMIN_ID;

  const { data, error } = await supabase.rpc(SUBSCRIPTION_PAYMENT_RPCS.takeOver, {
    p_attempt_id: params.id,
    p_admin_id: adminId,
    p_reason: reason,
    p_expected_version: expectedVersion,
  });

  if (error) {
    console.error("[admin/subscription-payments] take-over RPC error:", error.message);
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.ok) {
    const code = row?.error_code as string | undefined;
    return NextResponse.json(
      { error: RPC_ERROR_MESSAGES[code ?? ""] ?? code ?? "Takeover failed", code },
      { status: statusForRpcError(code) },
    );
  }

  void writeAdminAuditLog({
    adminUserId: adminIdForWrite(session),
    action: "subscription_payment.review_taken_over",
    targetType: "subscription_payment_attempt",
    targetId: params.id,
    metadata: {
      previous_reviewer: row.previous_reviewer ?? null,
      new_reviewer: adminId,
      reason,
      expected_version: expectedVersion,
      new_version: row.version ?? null,
    },
    ipAddress: req.headers.get("x-forwarded-for") ?? undefined,
  });

  return NextResponse.json({ ok: true, attempt: row });
}
