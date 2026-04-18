// GET /api/merchant/invoices/export
// Returns a CSV file of completed orders within a date range.
// Query params: from (YYYY-MM-DD), to (YYYY-MM-DD), status (optional)
// Scoped to authenticated merchant's partner_id.

import { NextResponse } from "next/server";
import { requireMerchantSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

function escapeCSV(val: string | number | null | undefined): string {
  if (val == null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(cells: (string | number | null | undefined)[]) {
  return cells.map(escapeCSV).join(",");
}

export async function GET(req: Request) {
  const session = await requireMerchantSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const status = url.searchParams.get("status") ?? "";

  // Build Supabase query
  let query = supabase
    .from("merchant_transactions")
    .select(
      "id,status,item_name,item_category,amount_cusd,amount_kes,payment_currency,payment_ref,voucher_code,recipient_name,phone,city,location_details,user_address,created_at,delivered_at,received_at,completed_at",
    )
    .eq("partner_id", session.partnerId)
    .order("created_at", { ascending: false });

  if (from) query = query.gte("created_at", `${from}T00:00:00.000Z`);
  if (to) query = query.lte("created_at", `${to}T23:59:59.999Z`);
  if (status) query = query.eq("status", status);

  const { data, error } = await query;

  if (error) {
    console.error("[invoices/export] query error:", error);
    return NextResponse.json({ error: "Failed to fetch orders" }, { status: 500 });
  }

  const orders = data ?? [];

  const headers = [
    "Invoice #",
    "Date",
    "Status",
    "Item",
    "Category",
    "Amount (cUSD)",
    "Amount (KES)",
    "Currency",
    "Payment Ref",
    "Voucher Code",
    "Recipient",
    "Phone",
    "City",
    "Address",
    "Customer Wallet",
  ];

  const lines: string[] = [headers.join(",")];

  for (const o of orders) {
    const date = o.created_at ? o.created_at.slice(0, 10) : "";
    const invoiceNum = `INV-${o.id.slice(0, 8).toUpperCase()}`;

    lines.push(
      row([
        invoiceNum,
        date,
        o.status,
        o.item_name,
        o.item_category,
        o.amount_cusd,
        o.amount_kes,
        o.payment_currency,
        o.payment_ref,
        o.voucher_code,
        o.recipient_name,
        o.phone,
        o.city,
        o.location_details,
        o.user_address,
      ]),
    );
  }

  const csv = lines.join("\n");
  const filename = `orders-export-${from ?? "all"}-to-${to ?? "all"}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
