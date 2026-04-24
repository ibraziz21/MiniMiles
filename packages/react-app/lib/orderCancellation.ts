// lib/orderCancellation.ts
// Compensation logic for cancelled merchant orders.
//
// Policy (explicit):
//   1. If the order used a voucher → reinstate it (status: "issued") so the
//      customer can use it on a future order.
//   2. Write a cancellation_compensations record so support has full visibility.
//   3. Payment refund is OUT OF SCOPE for automated handling — on-chain
//      transfers cannot be reversed programmatically. A manual refund record is
//      written so the support queue is populated; actual refund is operator-executed.
//
// This function is fire-and-forget safe — caller should log errors but not
// block the cancellation status update on compensation failures.

import { supabase } from "@/lib/supabaseClient";

export type CancellationCompensationResult = {
  voucherReinstated: boolean;
  compensationRecordId: string | null;
};

export async function handleOrderCancellation(
  orderId: string,
): Promise<CancellationCompensationResult> {
  // Fetch order details needed for compensation
  const { data: order, error: fetchErr } = await supabase
    .from("merchant_transactions")
    .select("id, user_address, voucher_id, voucher_code, amount_cusd, payment_ref, payment_currency, partner_id")
    .eq("id", orderId)
    .single();

  if (fetchErr || !order) {
    console.error("[cancellation] failed to fetch order for compensation", orderId, fetchErr);
    return { voucherReinstated: false, compensationRecordId: null };
  }

  let voucherReinstated = false;

  // ── 1. Reinstate voucher ──────────────────────────────────────────────────
  if (order.voucher_id) {
    const { error: vErr } = await supabase
      .from("issued_vouchers")
      .update({ status: "issued" })
      .eq("id", order.voucher_id)
      .eq("status", "redeemed"); // only reinstate if it was redeemed by this order

    if (vErr) {
      console.error("[cancellation] voucher reinstatement failed", order.voucher_id, vErr);
    } else {
      voucherReinstated = true;
    }
  }

  // ── 2. Write compensation record ─────────────────────────────────────────
  // This is the support queue entry. Refund action is manual.
  const { data: record, error: recErr } = await supabase
    .from("order_cancellation_compensations")
    .insert({
      order_id: orderId,
      user_address: order.user_address,
      partner_id: order.partner_id,
      amount_cusd: order.amount_cusd,
      payment_ref: order.payment_ref,
      payment_currency: order.payment_currency,
      voucher_id: order.voucher_id ?? null,
      voucher_reinstated: voucherReinstated,
      refund_status: "pending_manual",  // operator must execute on-chain refund
    })
    .select("id")
    .single();

  if (recErr) {
    console.error("[cancellation] compensation record insert failed", orderId, recErr);
  }

  return {
    voucherReinstated,
    compensationRecordId: record?.id ?? null,
  };
}
