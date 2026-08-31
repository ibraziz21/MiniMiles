// GET /api/admin/subscription-receipts/[id]
// Renders the immutable receipt for a confirmed subscription payment. `id` is
// the payment attempt id. Available only after the invoice is paid.

import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth";
import { getAdminSettings } from "@/lib/adminSettings";
import { supabase } from "@/lib/supabase";
import { isUuid, SUBSCRIPTION_PAYMENT_VIEWS } from "@/lib/subscriptionPayments";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function kes(value: unknown): string {
  const n = Number(value ?? 0);
  return `KES ${n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await requireAdminSession("finance.read");
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const { data: receipt, error } = await supabase
    .from(SUBSCRIPTION_PAYMENT_VIEWS.receipt)
    .select("*")
    .eq("payment_attempt_id", params.id)
    .maybeSingle();

  if (error) {
    console.error("[admin/subscription-receipts] error:", error.message);
    return NextResponse.json({ error: "Failed to load receipt" }, { status: 500 });
  }
  if (!receipt) return NextResponse.json({ error: "Receipt not found" }, { status: 404 });
  if (receipt.invoice_status !== "paid") {
    return NextResponse.json(
      { error: "Receipt is only available after the invoice is paid" },
      { status: 409 },
    );
  }

  const settings = await getAdminSettings();
  const businessName = settings.finance.businessName || "Akiba Ecosystems Ltd";
  const lineItems: Array<{ description: string; amount: unknown }> = Array.isArray(
    receipt.line_items,
  )
    ? receipt.line_items
    : [];

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(receipt.receipt_number)}</title>
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
      <div class="muted">Subscription Payment Receipt</div>
      ${settings.finance.businessEmail ? `<div class="muted">${esc(settings.finance.businessEmail)}</div>` : ""}
    </div>
    <div style="text-align:right">
      <h1>${esc(receipt.receipt_number)}</h1>
      <div class="muted">Invoice ${esc(receipt.invoice_number)}</div>
      <div class="muted">Paid ${esc(new Date(receipt.paid_at ?? receipt.confirmed_at).toLocaleString("en-KE"))}</div>
    </div>
  </div>

  <div>
    <div class="muted">Received From</div>
    <strong>${esc(receipt.merchant_name ?? receipt.partner_id)}</strong>
  </div>

  <table>
    <thead><tr><th>Description</th><th class="right">Amount</th></tr></thead>
    <tbody>
      ${lineItems
        .map(
          (item) =>
            `<tr><td>${esc(item.description)}</td><td class="right">${kes(item.amount)}</td></tr>`,
        )
        .join("")}
      <tr><td>Subtotal</td><td class="right">${kes(receipt.subtotal)}</td></tr>
      <tr><td>Discount</td><td class="right">-${kes(receipt.discount)}</td></tr>
      <tr><td>VAT</td><td class="right">${kes(0)}</td></tr>
      <tr class="total"><td>Total paid</td><td class="right">${kes(receipt.total)}</td></tr>
    </tbody>
  </table>

  <div class="box">
    <div class="muted">Payment Details</div>
    <p><strong>Method:</strong> ${esc(receipt.payment_method ?? "—")}</p>
    <p><strong>Confirmed reference:</strong> <code>${esc(receipt.confirmed_reference ?? "—")}</code></p>
    <p><strong>Bank settlement date:</strong> ${esc(
      receipt.payment_date ? new Date(receipt.payment_date).toLocaleDateString("en-KE") : "—",
    )}</p>
    <p><strong>Plan:</strong> ${esc(receipt.plan ?? "—")} · ${esc(receipt.billing_term ?? "—")}</p>
    ${
      receipt.next_renewal_at
        ? `<p><strong>Next renewal:</strong> ${esc(new Date(receipt.next_renewal_at).toLocaleDateString("en-KE"))}</p>`
        : ""
    }
  </div>
</body>
</html>`;

  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
