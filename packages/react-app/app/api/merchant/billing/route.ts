/**
 * GET /api/merchant/billing?slug=<merchant-slug>&year=2025&month=4
 *
 * Returns month-to-date billing summary for a merchant:
 *   - Total credits (revenue received this month)
 *   - Total debits (voucher redemptions, refunds, cancellation compensations)
 *   - Net position
 *   - Order count, average order value
 *   - Transaction list (credits + debits)
 *
 * Auth: x-merchant-secret header OR ?secret= query param matching
 *       the merchant's partner_settings.api_secret (or env MERCHANT_API_SECRET for dev).
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const DEFAULT_KES_RATE = 130;

function monthRange(year: number, month: number) {
  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString();
  const to   = new Date(Date.UTC(year, month, 1)).toISOString();
  return { from, to };
}

async function authMerchant(req: NextRequest, partnerId: string): Promise<boolean> {
  const secret =
    req.headers.get("x-merchant-secret") ??
    req.nextUrl.searchParams.get("secret") ??
    "";
  // Dev fallback: single env var for all merchants
  if (process.env.MERCHANT_API_SECRET && secret === process.env.MERCHANT_API_SECRET) return true;
  // Per-merchant secret stored in partner_settings
  const { data } = await supabase
    .from("partner_settings")
    .select("api_secret")
    .eq("partner_id", partnerId)
    .maybeSingle();
  return !!data?.api_secret && secret === data.api_secret;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const slug  = searchParams.get("slug");
  const year  = parseInt(searchParams.get("year")  ?? String(new Date().getUTCFullYear()), 10);
  const month = parseInt(searchParams.get("month") ?? String(new Date().getUTCMonth() + 1), 10);

  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12)
    return NextResponse.json({ error: "invalid year/month" }, { status: 400 });

  // Resolve partner
  const { data: partner, error: pErr } = await supabase
    .from("partners")
    .select("id")
    .eq("slug", slug)
    .single();
  if (pErr || !partner) return NextResponse.json({ error: "merchant not found" }, { status: 404 });

  if (!(await authMerchant(req, partner.id)))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // KES rate for this merchant
  const { data: settings } = await supabase
    .from("partner_settings")
    .select("kes_exchange_rate, payout_wallet")
    .eq("partner_id", partner.id)
    .maybeSingle();
  const kesRate = Number(settings?.kes_exchange_rate ?? DEFAULT_KES_RATE);

  const { from, to } = monthRange(year, month);

  // Pull all orders for this merchant in the window
  const { data: orders, error: oErr } = await supabase
    .from("merchant_transactions")
    .select(
      `id, created_at, status, action,
       item_name, item_category, product_id,
       amount_cusd, amount_kes,
       voucher_code, voucher_id,
       discount_kes,
       payment_currency, payment_ref,
       akiba_username, user_address`
    )
    .eq("partner_id", partner.id)
    .gte("created_at", from)
    .lt("created_at", to)
    .order("created_at", { ascending: false });

  if (oErr) {
    console.error("[merchant/billing]", oErr);
    return NextResponse.json({ error: "db-error" }, { status: 500 });
  }

  const rows = orders ?? [];

  // Credits = completed/placed orders; Debits = refunds, cancellations, compensations
  const DEBIT_STATUSES = new Set(["cancelled", "refunded", "compensation"]);

  let totalCreditsCusd = 0;
  let totalDebitsCusd  = 0;
  let orderCount       = 0;

  const transactions = rows.map((row) => {
    const amountCusd = Number(row.amount_cusd ?? 0);
    const amountKes  = row.amount_kes != null
      ? Number(row.amount_kes)
      : Math.round(amountCusd * kesRate);
    const isDebit    = DEBIT_STATUSES.has(row.status);

    if (isDebit) {
      totalDebitsCusd += amountCusd;
    } else {
      totalCreditsCusd += amountCusd;
      orderCount++;
    }

    return {
      id:               row.id,
      date:             row.created_at,
      type:             isDebit ? "debit" : "credit",
      status:           row.status,
      description:      row.item_name ?? row.action ?? "Order",
      category:         row.item_category ?? null,
      product_id:       row.product_id ?? null,
      amount_cusd:      amountCusd,
      amount_kes:       amountKes,
      voucher_code:     row.voucher_code ?? null,
      discount_kes:     row.discount_kes ?? null,
      payment_currency: row.payment_currency ?? null,
      payment_ref:      row.payment_ref ?? null,
      customer:         row.akiba_username ?? row.user_address?.slice(0, 10) ?? null,
    };
  });

  const netCusd    = totalCreditsCusd - totalDebitsCusd;
  const avgOrderCusd = orderCount > 0 ? totalCreditsCusd / orderCount : 0;

  return NextResponse.json({
    period:   { year, month },
    currency: { usd_label: "USD", kes_rate: kesRate },
    summary: {
      total_credits_cusd:   round2(totalCreditsCusd),
      total_credits_kes:    Math.round(totalCreditsCusd * kesRate),
      total_debits_cusd:    round2(totalDebitsCusd),
      total_debits_kes:     Math.round(totalDebitsCusd * kesRate),
      net_cusd:             round2(netCusd),
      net_kes:              Math.round(netCusd * kesRate),
      order_count:          orderCount,
      avg_order_cusd:       round2(avgOrderCusd),
      avg_order_kes:        Math.round(avgOrderCusd * kesRate),
    },
    payout_wallet: settings?.payout_wallet ?? null,
    transactions,
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
