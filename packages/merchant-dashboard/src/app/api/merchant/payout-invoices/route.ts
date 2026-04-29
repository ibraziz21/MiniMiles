// GET /api/merchant/payout-invoices
//   Lists all payout bills for this partner.
//   If no bill exists for the current calendar month, one is auto-created
//   as a draft (system-generated, no created_by user).
//
// Fee model (fixed for all merchants):
//   Subscription fee : $20.00 / month
//   Service fee      : 2% of gross GMV from completed orders
//   Net payout       : gross - subscription_fee - service_fee

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import type { PayoutInvoice } from "@/types";

const SUBSCRIPTION_FEE = 20.00;
const SERVICE_FEE_RATE = 0.02; // 2%

function currentMonth() {
  return new Date().toISOString().slice(0, 7); // "YYYY-MM"
}

function periodBounds(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const nextM = m === 12 ? 1 : m + 1;
  const nextY = m === 12 ? y + 1 : y;
  return {
    start: `${ym}-01T00:00:00.000Z`,
    end:   `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00.000Z`,
  };
}

async function ensureCurrentMonthBill(partnerId: string): Promise<PayoutInvoice | null> {
  const month = currentMonth();

  // Check if one already exists
  const { data: existing } = await supabase
    .from("payout_invoices")
    .select("*")
    .eq("partner_id", partnerId)
    .eq("period_month", month)
    .maybeSingle();

  if (existing) return existing as PayoutInvoice;

  // Compute GMV from completed orders this month
  const { start, end } = periodBounds(month);
  const { data: txs } = await supabase
    .from("merchant_transactions")
    .select("amount_cusd")
    .eq("partner_id", partnerId)
    .in("status", ["delivered", "received", "completed"])
    .gte("created_at", start)
    .lt("created_at", end);

  const order_count = txs?.length ?? 0;
  const gross_cusd = Math.round(
    (txs ?? []).reduce((acc, t) => acc + (t.amount_cusd ?? 0), 0) * 100,
  ) / 100;

  const service_fee_cusd = Math.round(gross_cusd * SERVICE_FEE_RATE * 100) / 100;
  const net_cusd = Math.max(
    0,
    Math.round((gross_cusd - SUBSCRIPTION_FEE - service_fee_cusd) * 100) / 100,
  );

  const { data: created, error } = await supabase
    .from("payout_invoices")
    .insert({
      partner_id:           partnerId,
      period_month:         month,
      order_count,
      gross_cusd,
      subscription_fee_cusd: SUBSCRIPTION_FEE,
      service_fee_cusd,
      net_cusd,
      status:               "draft",
      created_by:           null, // system-generated
    })
    .select()
    .single();

  if (error) {
    // Race condition: another request inserted it first — fetch it
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("payout_invoices")
        .select("*")
        .eq("partner_id", partnerId)
        .eq("period_month", month)
        .single();
      return raced as PayoutInvoice | null;
    }
    console.error("[payout-invoices] auto-create error:", error);
    return null;
  }

  return created as PayoutInvoice;
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Auto-create current-month bill if missing (fire-and-forget the error — list still works)
  await ensureCurrentMonthBill(session.partnerId);

  const { data, error } = await supabase
    .from("payout_invoices")
    .select("*")
    .eq("partner_id", session.partnerId)
    .order("period_month", { ascending: false });

  if (error) {
    console.error("[payout-invoices] list error:", error);
    return NextResponse.json({ error: "Failed to load bills" }, { status: 500 });
  }

  return NextResponse.json({ invoices: (data ?? []) as PayoutInvoice[] });
}
