import { redirect } from "next/navigation";
import { requireAdminSession } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/utils";
import { PayoutInvoiceActions } from "@/components/finance/PayoutInvoiceActions";
import { ExternalLink } from "lucide-react";

type PayoutInvoiceRow = {
  id: string;
  partner_id: string;
  period_month: string;
  status: "draft" | "submitted" | "paid" | "rejected";
  order_count: number;
  gross_cusd: number | string | null;
  subscription_fee_cusd: number | string | null;
  service_fee_cusd: number | string | null;
  net_cusd: number | string | null;
  akiba_notes: string | null;
  resolved_at: string | null;
  created_at: string;
  payment_method: string | null;
  payment_destination_snapshot: Record<string, unknown> | null;
  payment_tx_hash: string | null;
  payment_reference: string | null;
  receipt_number: string | null;
  paid_at: string | null;
  partners: { name: string } | null;
};

type PartnerSettingsRow = {
  partner_id: string;
  payout_destination_type: "wallet" | "bank" | "mpesa" | null;
  payout_wallet: string | null;
  payout_bank_name: string | null;
  payout_bank_branch: string | null;
  payout_bank_account_name: string | null;
  payout_bank_account_number: string | null;
  payout_mpesa_name: string | null;
  payout_mpesa_phone: string | null;
  payout_notes: string | null;
};

function usd(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function defaultMethod(settings?: PartnerSettingsRow): string {
  return settings?.payout_destination_type ?? "manual";
}

function destinationLabel(settings?: PartnerSettingsRow, snapshot?: Record<string, unknown> | null): string {
  const type = String(snapshot?.type ?? settings?.payout_destination_type ?? "manual");
  if (type === "bank") {
    const bank = snapshot?.bank_name ?? settings?.payout_bank_name;
    const acct = snapshot?.account_number ?? settings?.payout_bank_account_number;
    return [bank, acct].filter(Boolean).join(" · ") || "Bank";
  }
  if (type === "mpesa") {
    const phone = snapshot?.phone ?? settings?.payout_mpesa_phone;
    return phone ? `M-Pesa · ${phone}` : "M-Pesa";
  }
  if (type === "wallet") {
    const wallet = snapshot?.wallet ?? settings?.payout_wallet;
    return wallet ? `Wallet · ${String(wallet).slice(0, 8)}...${String(wallet).slice(-6)}` : "Wallet";
  }
  return "Manual";
}

async function getFinance() {
  const [ordersRes, invoicesRes] = await Promise.all([
    supabase
      .from("merchant_transactions")
      .select("id, status, amount_cusd, partner_id, created_at")
      .order("created_at", { ascending: false }),
    supabase
      .from("payout_invoices")
      .select("id, partner_id, period_month, status, order_count, gross_cusd, subscription_fee_cusd, service_fee_cusd, net_cusd, akiba_notes, resolved_at, created_at, payment_method, payment_destination_snapshot, payment_tx_hash, payment_reference, receipt_number, paid_at, partners(name)")
      .order("created_at", { ascending: false })
      .limit(80),
  ]);

  const invoices = (invoicesRes.data ?? []) as unknown as PayoutInvoiceRow[];
  const partnerIds = [...new Set(invoices.map((invoice) => invoice.partner_id))];
  const settingsRes = partnerIds.length
    ? await supabase
        .from("partner_settings")
        .select("partner_id, payout_destination_type, payout_wallet, payout_bank_name, payout_bank_branch, payout_bank_account_name, payout_bank_account_number, payout_mpesa_name, payout_mpesa_phone, payout_notes")
        .in("partner_id", partnerIds)
    : { data: [] as PartnerSettingsRow[] };

  const settingsMap: Record<string, PartnerSettingsRow> = {};
  for (const settings of (settingsRes.data ?? []) as PartnerSettingsRow[]) {
    settingsMap[settings.partner_id] = settings;
  }

  return {
    orders: (ordersRes.data ?? []) as Array<{
      id: string;
      status: string;
      amount_cusd: number | null;
      partner_id: string;
      created_at: string;
    }>,
    invoices,
    settingsMap,
  };
}

export default async function FinancePage() {
  const session = await requireAdminSession("finance.read");
  if (!session) redirect("/login");

  const { orders, invoices, settingsMap } = await getFinance();
  const completed = orders.filter((order) => ["delivered", "received", "completed"].includes(order.status));
  const receivable = orders.filter((order) => ["accepted", "packed", "out_for_delivery"].includes(order.status));
  const revenue = completed.reduce((sum, order) => sum + (order.amount_cusd ?? 0), 0);
  const inFlight = receivable.reduce((sum, order) => sum + (order.amount_cusd ?? 0), 0);
  const submittedPayouts = invoices.filter((invoice) => invoice.status === "draft" || invoice.status === "submitted");
  const paidPayouts = invoices.filter((invoice) => invoice.status === "paid");
  const pendingNet = submittedPayouts.reduce((sum, invoice) => sum + usd(invoice.net_cusd), 0);
  const paidNet = paidPayouts.reduce((sum, invoice) => sum + usd(invoice.net_cusd), 0);
  const canWrite = session.role === "super_admin" || session.role === "finance_admin";

  return (
    <div>
      <TopBar title="Finance" subtitle="Merchant revenue, payout processing, and receipts" />
      <div className="space-y-6 p-6">
        <div className="grid gap-4 sm:grid-cols-4">
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Completed Revenue</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${formatNumber(Math.round(revenue * 100) / 100)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">In Flight</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold">${formatNumber(Math.round(inFlight * 100) / 100)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Awaiting Payout</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-amber-600">${formatNumber(Math.round(pendingNet * 100) / 100)}</p></CardContent></Card>
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-slate-500">Paid Out</CardTitle></CardHeader><CardContent><p className="text-2xl font-bold text-emerald-600">${formatNumber(Math.round(paidNet * 100) / 100)}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Payout Invoices</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invoices.length === 0 && <p className="text-sm text-slate-400">No invoices found.</p>}
              {invoices.map((invoice) => {
                const settings = settingsMap[invoice.partner_id];
                return (
                  <div key={invoice.id} className="rounded-lg border border-slate-100 px-4 py-3 text-sm">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium text-slate-900">{invoice.partners?.name ?? invoice.partner_id}</p>
                          <Badge variant={invoice.status === "paid" ? "success" : invoice.status === "rejected" ? "destructive" : invoice.status === "submitted" ? "warning" : "secondary"}>
                            {invoice.status}
                          </Badge>
                          {invoice.receipt_number && <Badge variant="outline">{invoice.receipt_number}</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          {invoice.period_month} · {invoice.order_count} orders · Created {formatDate(invoice.created_at)}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          Destination: {destinationLabel(settings, invoice.payment_destination_snapshot)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-lg font-semibold text-slate-900">${formatNumber(usd(invoice.net_cusd))}</p>
                        <p className="text-xs text-slate-400">gross ${formatNumber(usd(invoice.gross_cusd))}</p>
                      </div>
                    </div>

                    {(invoice.payment_reference || invoice.payment_tx_hash || invoice.akiba_notes) && (
                      <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        {invoice.payment_reference && <p>Reference: <span className="font-mono">{invoice.payment_reference}</span></p>}
                        {invoice.payment_tx_hash && <p className="break-all">Tx: <span className="font-mono">{invoice.payment_tx_hash}</span></p>}
                        {invoice.akiba_notes && <p className="whitespace-pre-wrap">Note: {invoice.akiba_notes}</p>}
                      </div>
                    )}

                    {(invoice.status === "draft" || invoice.status === "submitted") && canWrite && (
                      <PayoutInvoiceActions
                        invoiceId={invoice.id}
                        defaultPaymentMethod={defaultMethod(settings)}
                      />
                    )}

                    {invoice.status === "paid" && (
                      <a
                        href={`/api/admin/payout-invoices/${invoice.id}/receipt`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[#238D9D] hover:underline"
                      >
                        Open receipt <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
