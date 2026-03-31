// GET /api/Spend/orders/user/[address]
// Returns order history for a given user address from merchant_transactions.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

const KES_RATE = 130;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address: rawAddress } = await params;
  const address = rawAddress?.toLowerCase();
  if (!address) {
    return NextResponse.json({ error: "address is required" }, { status: 400 });
  }

  const { data: transactions, error } = await supabase
    .from("merchant_transactions")
    .select(
      `id, partner_id, category, voucher, quote_kes, labor_kes, discount_kes, paid_kes,
       payment_method, payment_currency, payment_ref, status, error, created_at, completed_at`,
    )
    .eq("user_address", address)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[GET /orders/user]", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }

  const partnerIds = [...new Set((transactions ?? []).map((row) => row.partner_id).filter(Boolean))];

  let partnerMap = new Map<string, { id: string; name: string; slug: string; image_url?: string | null }>();
  if (partnerIds.length > 0) {
    const { data: partners, error: partnerErr } = await supabase
      .from("partners")
      .select("id, name, slug, image_url")
      .in("id", partnerIds);

    if (partnerErr) {
      console.error("[GET /orders/user partners]", partnerErr);
    } else {
      partnerMap = new Map((partners ?? []).map((partner) => [partner.id, partner]));
    }
  }

  const orders = (transactions ?? []).map((row) => {
    const deliveryKes = row.labor_kes ?? 0;
    const amountPaidKes = row.paid_kes ?? (row.quote_kes ?? 0) + deliveryKes - (row.discount_kes ?? 0);

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
      created_at: row.created_at,
      completed_at: row.completed_at,
      partner: row.partner_id ? partnerMap.get(row.partner_id) ?? null : null,
    };
  });

  return NextResponse.json({ orders });
}
