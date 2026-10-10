import { NextResponse } from "next/server";
import { requireAdminSession, adminIdForWrite } from "@/lib/auth";
import { hasPermission } from "@/types";
import { supabase } from "@/lib/supabase";
import { getVoucherReimbursementDashboard } from "@/lib/voucherReimbursements";
import { akibaFundedVouchersFinanceFlag } from "@/lib/featureFlags";
import { OPEN_ACCESS_ACTOR_ID, messageForRpcError, parseRpcErrorCode } from "@/lib/voucherFunds";
import { writeAdminAuditLog } from "@/lib/audit";
import { isTrustedMutationRequest } from "@/lib/requestSecurity";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["create_batch", "submit_batch", "mark_paid", "cancel_batch", "reverse_redemption", "resolve_incident"]);

function unavailable() {
  return NextResponse.json({ error: "Funded-voucher reimbursement operations are not enabled." }, { status: 503 });
}

export async function GET() {
  const session = await requireAdminSession("voucher_settlements.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!akibaFundedVouchersFinanceFlag()) return unavailable();
  try {
    return NextResponse.json(await getVoucherReimbursementDashboard(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("[voucher-reimbursements:get]", error);
    return NextResponse.json({ error: "Voucher reimbursement data is unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  if (!isTrustedMutationRequest(request)) return NextResponse.json({ error: "Cross-site request rejected." }, { status: 403 });
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!akibaFundedVouchersFinanceFlag()) return unavailable();
  if (process.env.NODE_ENV === "production" && !adminIdForWrite(session)) return NextResponse.json({ error: "A real admin identity is required." }, { status: 403 });

  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!ACTIONS.has(action)) return NextResponse.json({ error: "Unsupported reimbursement action." }, { status: 400 });

  const writePermission = action === "mark_paid" ? "voucher_settlements.mark_paid" : "voucher_settlements.write";
  if (!hasPermission(session.role, writePermission)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const actorId = adminIdForWrite(session) ?? OPEN_ACCESS_ACTOR_ID;

  if (action === "create_batch") {
    const merchantId = typeof body?.merchant_id === "string" ? body.merchant_id : "";
    const redemptionIds = Array.isArray(body?.voucher_redemption_ids) ? body.voucher_redemption_ids.filter((id): id is string => typeof id === "string" && UUID.test(id)) : [];
    if (!UUID.test(merchantId) || redemptionIds.length === 0 || redemptionIds.length > 200) return NextResponse.json({ error: "Select at least one valid payable for one merchant." }, { status: 400 });

    const { data: payables } = await supabase.from("v_unbatched_voucher_payables").select("voucher_redemption_id, merchant_id, payout_ready").in("voucher_redemption_id", redemptionIds);
    if ((payables ?? []).length !== redemptionIds.length || (payables ?? []).some((row) => row.merchant_id !== merchantId || !row.payout_ready)) {
      return NextResponse.json({ error: "Every selected payable must belong to this merchant and have an approved payout destination." }, { status: 409 });
    }
    const { data, error } = await supabase.rpc("create_voucher_reimbursement_batch_atomic", { p_merchant_id: merchantId, p_actor_id: actorId, p_voucher_redemption_ids: redemptionIds }).single();
    if (error) return NextResponse.json({ error: messageForRpcError(error), code: parseRpcErrorCode(error) }, { status: 409 });
    const createdBatch = data as { id?: string } | null;
    if (!createdBatch?.id) return NextResponse.json({ error: "The batch was not returned after creation." }, { status: 502 });
    await writeAdminAuditLog({ adminUserId: adminIdForWrite(session), action: "voucher_reimbursement_batch.created", targetType: "voucher_reimbursement_batch", targetId: createdBatch.id, metadata: { merchant_id: merchantId, item_count: redemptionIds.length } });
    return NextResponse.json({ batch: data }, { status: 201 });
  }

  if (action === "submit_batch" || action === "mark_paid" || action === "cancel_batch") {
    const batchId = typeof body?.batch_id === "string" ? body.batch_id : "";
    if (!UUID.test(batchId)) return NextResponse.json({ error: "A valid batch is required." }, { status: 400 });
    const transition = action === "submit_batch" ? "submit" : action === "mark_paid" ? "pay" : "cancel";
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const paymentReference = typeof body?.payment_reference === "string" ? body.payment_reference.trim().slice(0, 120) : "";
    const paymentEvidenceRef = typeof body?.payment_evidence_ref === "string" ? body.payment_evidence_ref.trim().slice(0, 500) : "";
    const confirmedTotalMinor = typeof body?.confirmed_total_minor === "number" ? body.confirmed_total_minor : Number(body?.confirmed_total_minor);
    const { data: batch } = await supabase.from("voucher_funding_reimbursement_batches").select("id, merchant_id, total_amount_minor, created_by, state").eq("id", batchId).maybeSingle();
    if (!batch) return NextResponse.json({ error: "Batch not found." }, { status: 404 });
    if (transition === "cancel" && reason.length < 4) return NextResponse.json({ error: "A cancellation reason of at least four characters is required." }, { status: 400 });
    if (transition === "pay") {
      if (!paymentReference || !paymentEvidenceRef) return NextResponse.json({ error: "Payment reference and evidence reference are required." }, { status: 400 });
      if (!Number.isFinite(confirmedTotalMinor) || confirmedTotalMinor !== Number(batch.total_amount_minor)) return NextResponse.json({ error: "Confirm the exact batch total before recording payment." }, { status: 400 });
      if (batch.created_by === actorId && session.role !== "super_admin") return NextResponse.json({ error: "A different Finance operator must record payment for this batch." }, { status: 409 });
    }
    const { data, error } = await supabase.rpc("transition_voucher_reimbursement_batch_atomic", { p_batch_id: batchId, p_action: transition, p_actor_id: actorId, p_payment_reference: paymentReference || null, p_payment_evidence_ref: paymentEvidenceRef || null, p_reason: reason || null }).single();
    if (error) return NextResponse.json({ error: messageForRpcError(error), code: parseRpcErrorCode(error) }, { status: 409 });
    const auditAction = transition === "submit" ? "submitted" : transition === "pay" ? "paid" : "cancelled";
    await writeAdminAuditLog({ adminUserId: adminIdForWrite(session), action: `voucher_reimbursement_batch.${auditAction}`, targetType: "voucher_reimbursement_batch", targetId: batchId, metadata: { merchant_id: batch.merchant_id, total_amount_minor: batch.total_amount_minor } });
    return NextResponse.json({ batch: data });
  }

  if (action === "reverse_redemption") {
    const redemptionId = typeof body?.voucher_redemption_id === "string" ? body.voucher_redemption_id : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 500) : "";
    const full = body?.full !== false;
    const amountKes = typeof body?.amount_kes === "number" ? body.amount_kes : null;
    if (!UUID.test(redemptionId) || reason.length < 4 || (!full && (!amountKes || amountKes <= 0))) return NextResponse.json({ error: "A valid redemption, reason, and reversal amount are required." }, { status: 400 });
    const { data, error } = await supabase.rpc("reverse_akiba_funded_redemption_atomic", { p_voucher_redemption_id: redemptionId, p_actor_id: actorId, p_reason: reason, p_full: full, p_reversal_amount_kes: full ? null : amountKes });
    if (error) return NextResponse.json({ error: messageForRpcError(error), code: parseRpcErrorCode(error) }, { status: 409 });
    await writeAdminAuditLog({ adminUserId: adminIdForWrite(session), action: "voucher_redemption.reversed", targetType: "voucher_redemption", targetId: redemptionId, metadata: { full } });
    return NextResponse.json({ reversal: Array.isArray(data) ? data[0] : data });
  }

  return NextResponse.json({ error: "Incident resolution is waiting on the Platform atomic control." , code: "ACTION_NOT_ENABLED" }, { status: 409 });
}
