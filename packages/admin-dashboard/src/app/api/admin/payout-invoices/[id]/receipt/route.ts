// GET /api/admin/payout-invoices/[id]/receipt
// Returns a printable HTML receipt for paid merchant payouts.

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { getAdminSettings } from "@/lib/adminSettings";
import { supabase } from "@/lib/supabase";

function money(value: unknown): string {
  return `$${Number(value ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: invoice, error } = await supabase
    .from("payout_invoices")
    .select("*, partners(name, country)")
    .eq("id", params.id)
    .single();

  if (error || !invoice) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (invoice.status !== "paid") {
    return NextResponse.json({ error: "Receipt is only available after payout is paid" }, { status: 409 });
  }

  const settings = await getAdminSettings();
  const destination = invoice.payment_destination_snapshot ?? {};
  const receipt = invoice.receipt_number ?? `${settings.finance.receiptPrefix}-${invoice.period_month}-${invoice.id.slice(0, 8).toUpperCase()}`;
  const partnerName = invoice.partners?.name ?? invoice.partner_id;
  const paidAt = invoice.paid_at ?? invoice.resolved_at ?? invoice.updated_at;
  const businessName = settings.finance.businessName || "AkibaMiles";

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(receipt)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #0f172a; margin: 0; padding: 40px; }
    .header { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #238D9D; padding-bottom: 24px; margin-bottom: 28px; }
    .brand { color: #238D9D; font-size: 22px; font-weight: 800; }
    .muted { color: #64748b; font-size: 12px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    table { width: 100%; border-collapse: collapse; margin: 24px 0; }
    th { text-align: left; color: #64748b; font-size: 11px; text-transform: uppercase; padding: 10px; background: #f8fafc; }
    td { padding: 12px 10px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .right { text-align: right; }
    .total td { border-top: 2px solid #238D9D; font-size: 16px; font-weight: 800; }
    .box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-top: 18px; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; word-break: break-all; }
    @media print { body { padding: 24px; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">${esc(businessName)}</div>
      <div class="muted">Merchant Payout Receipt</div>
      ${settings.finance.businessEmail ? `<div class="muted">${esc(settings.finance.businessEmail)}</div>` : ""}
      ${settings.finance.businessPhone ? `<div class="muted">${esc(settings.finance.businessPhone)}</div>` : ""}
      ${settings.finance.businessAddress ? `<div class="muted">${esc(settings.finance.businessAddress)}</div>` : ""}
    </div>
    <div style="text-align:right">
      <h1>${esc(receipt)}</h1>
      <div class="muted">Period ${esc(invoice.period_month)}</div>
      <div class="muted">Paid ${esc(new Date(paidAt).toLocaleString("en-KE"))}</div>
    </div>
  </div>

  <div>
    <div class="muted">Paid To</div>
    <strong>${esc(partnerName)}</strong>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
    <tbody>
      <tr><td>Gross revenue (${esc(invoice.order_count)} completed orders)</td><td class="right">${money(invoice.gross_cusd)}</td></tr>
      <tr><td>Subscription fee</td><td class="right">-${money(invoice.subscription_fee_cusd)}</td></tr>
      <tr><td>Service fee</td><td class="right">-${money(invoice.service_fee_cusd)}</td></tr>
      <tr class="total"><td>Net payout</td><td class="right">${money(invoice.net_cusd)}</td></tr>
    </tbody>
  </table>

  <div class="box">
    <div class="muted">Payment Details</div>
    <p><strong>Method:</strong> ${esc(invoice.payment_method ?? destination.type ?? "manual")}</p>
    ${invoice.payment_reference ? `<p><strong>Reference:</strong> <code>${esc(invoice.payment_reference)}</code></p>` : ""}
    ${invoice.payment_tx_hash ? `<p><strong>Transaction hash:</strong> <code>${esc(invoice.payment_tx_hash)}</code></p>` : ""}
    ${invoice.akiba_notes ? `<p><strong>Notes:</strong> ${esc(invoice.akiba_notes)}</p>` : ""}
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
