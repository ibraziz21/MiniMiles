// GET /api/Spend/orders/user/[address]
// Returns order history for the authenticated user.
// Session is required and must match the requested address.

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";
import { requireSession } from "@/lib/auth";

const KES_RATE = 130;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { address: rawAddress } = await params;
  const address = rawAddress?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  // Users may only fetch their own orders
  if (session.walletAddress.toLowerCase() !== address) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: transactions, error } = await supabase
    .from("merchant_transactions")
    .select(
      `id, partner_id, category, voucher, quote_kes, labor_kes, discount_kes, paid_kes,
       payment_method, payment_currency, payment_ref, status, error,
       recipient_name, phone, city, location_details,
       created_at, accepted_at, packed_at, dispatched_at,
       delivered_at, received_at, cancelled_at, completed_at,
       miles_reward_status`,
    )
    .eq("user_address", address)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /orders/user]", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }

  const partnerIds = [...new Set((transactions ?? []).map((r) => r.partner_id).filter(Boolean))];
  let partnerMap = new Map<string, { id: string; name: string; slug: string; image_url?: string | null }>();

  if (partnerIds.length > 0) {
    const { data: partners, error: partnerErr } = await supabase
      .from("partners")
      .select("id, name, slug, image_url")
      .in("id", partnerIds);

    if (partnerErr) {
      console.error("[GET /orders/user partners]", partnerErr);
    } else {
      partnerMap = new Map((partners ?? []).map((p) => [p.id, p]));
    }
  }

  const orders = (transactions ?? []).map((row) => {
    const deliveryKes = row.labor_kes ?? 0;
    const amountPaidKes =
      row.paid_kes ?? (row.quote_kes ?? 0) + deliveryKes - (row.discount_kes ?? 0);

    return {
      id: row.id,
      status: row.status,
      category: row.category,
      voucher: row.voucher,
      quote_kes: row.quote_kes,
      delivery_kes: deliveryKes,
      discount_kes: row.discount_kes,
      paid_kes: row.paid_kes,
      amount_paid_kes: amountPaidKes,
      amount_paid_cusd: Math.round((amountPaidKes / KES_RATE) * 100) / 100,
      payment_method: row.payment_method,
      payment_currency: row.payment_currency,
      payment_ref: row.payment_ref,
      error: row.error,
      // Delivery details
      recipient_name: row.recipient_name,
      phone: row.phone,
      city: row.city,
      location_details: row.location_details,
      // Lifecycle timestamps
      created_at:    row.created_at,
      accepted_at:   row.accepted_at,
      packed_at:     row.packed_at,
      dispatched_at: row.dispatched_at,
      delivered_at:  row.delivered_at,
      received_at:   row.received_at,
      cancelled_at:  row.cancelled_at,
      completed_at:  row.completed_at,
      // Reward
      miles_reward_status: row.miles_reward_status,
      partner: row.partner_id ? partnerMap.get(row.partner_id) ?? null : null,
    };
  });

  return NextResponse.json({ orders });
}
