"use client";

import { useState, useEffect, useRef } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Plus,
  Send,
  CheckCircle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronUp,
  X,
  Printer,
  Download,
} from "lucide-react";
import type { PayoutInvoice, MerchantOrder, OrderStatus } from "@/types";
import { ORDER_STATUSES } from "@/types";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { Input } from "@/components/ui/input";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtUSD(val: number | null | undefined) {
  if (val == null) return "—";
  return `$${Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtKES(val: number | null | undefined) {
  if (val == null) return "—";
  return `KES ${Math.round(Number(val) * 130).toLocaleString("en-KE")}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function invoiceRef(inv: PayoutInvoice) {
  return `PAY-${inv.period_month}-${inv.id.slice(0, 6).toUpperCase()}`;
}

function orderInvoiceNum(id: string) {
  return `INV-${id.slice(0, 8).toUpperCase()}`;
}

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_META: Record<PayoutInvoice["status"], { label: string; icon: React.ReactNode; cls: string }> = {
  draft:     { label: "Draft",     icon: <FileText className="h-3.5 w-3.5" />, cls: "bg-gray-100 text-gray-600" },
  submitted: { label: "Submitted", icon: <Clock className="h-3.5 w-3.5" />,    cls: "bg-amber-50 text-amber-700" },
  paid:      { label: "Paid",      icon: <CheckCircle className="h-3.5 w-3.5" />, cls: "bg-emerald-50 text-emerald-700" },
  rejected:  { label: "Rejected",  icon: <XCircle className="h-3.5 w-3.5" />,  cls: "bg-red-50 text-red-700" },
};

function StatusPill({ status }: { status: PayoutInvoice["status"] }) {
  const { label, icon, cls } = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ── Create invoice modal ───────────────────────────────────────────────────────

function CreateInvoiceModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (inv: PayoutInvoice) => void;
}) {
  const [month, setMonth] = useState(currentMonth());
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/merchant/payout-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", period_month: month, notes: notes.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Failed to create invoice"); return; }
      onCreate(d.invoice as PayoutInvoice);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="text-base font-semibold text-gray-900">New Payout Invoice</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <p className="text-sm text-gray-500">
            Select the billing month. We will calculate the total from your completed orders in that period.
          </p>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Billing month</label>
            <input
              type="month"
              value={month}
              max={currentMonth()}
              onChange={(e) => setMonth(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-gray-600">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any context, disputes, or notes for AkibaMiles…"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-none"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-gray-100 px-6 py-4">
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={handleCreate} disabled={loading}>
            {loading ? "Creating…" : "Create Invoice"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Payout invoice detail / print modal ───────────────────────────────────────

function PayoutInvoiceModal({
  invoice,
  partnerName,
  onClose,
  onSubmit,
}: {
  invoice: PayoutInvoice;
  partnerName: string;
  onClose: () => void;
  onSubmit: (updated: PayoutInvoice) => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/merchant/payout-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "submit", invoice_id: invoice.id }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.error ?? "Failed to submit"); return; }
      onSubmit(d.invoice as PayoutInvoice);
    } catch {
      setError("Network error");
    } finally {
      setSubmitting(false);
    }
  }

  function handlePrint() {
    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const win = window.open("", "_blank", "width=800,height=1000");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <title>${invoiceRef(invoice)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #111; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #238D9D; }
        .brand { font-size: 22px; font-weight: 800; color: #238D9D; }
        .brand-sub { font-size: 12px; color: #666; margin-top: 2px; }
        .inv-num { font-size: 20px; font-weight: 700; }
        .inv-date { font-size: 12px; color: #666; margin-top: 4px; }
        .status-pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .amount-box { background: #f0f9fa; border: 1px solid #238D9D33; border-radius: 8px; padding: 20px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
        .amount-big { font-size: 32px; font-weight: 800; color: #238D9D; }
        .amount-kes { font-size: 14px; color: #555; margin-top: 4px; }
        .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
        .field label { font-size: 11px; color: #888; }
        .field p { font-size: 13px; font-weight: 500; margin-top: 2px; }
        .notes-box { background: #fafafa; border: 1px solid #eee; border-radius: 8px; padding: 14px; margin-bottom: 24px; }
        .notes-label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #999; margin-bottom: 6px; }
        .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
        @media print { body { padding: 20px; } }
      </style>
    </head><body>${content}</body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white/95 backdrop-blur px-5 py-3">
          <span className="text-sm font-semibold text-gray-800">{invoiceRef(invoice)}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1.5">
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </Button>
            {invoice.status === "draft" && (
              <Button size="sm" onClick={handleSubmit} disabled={submitting} className="gap-1.5">
                <Send className="h-3.5 w-3.5" />
                {submitting ? "Submitting…" : "Submit to AkibaMiles"}
              </Button>
            )}
            <button onClick={onClose} className="ml-1 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>
        )}

        {/* Invoice content */}
        <div ref={printRef} className="p-8">
          {/* Header */}
          <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-[#238D9D]">
            <div>
              <p className="text-xl font-extrabold text-[#238D9D]">{partnerName}</p>
              <p className="text-xs text-gray-500 mt-0.5">AkibaMiles Merchant Partner</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-gray-900">{invoiceRef(invoice)}</p>
              <p className="text-xs text-gray-500 mt-1">Created: {formatDate(invoice.created_at)}</p>
              <div className="mt-2">
                <StatusPill status={invoice.status} />
              </div>
            </div>
          </div>

          {/* Amount */}
          <div className="mb-6 flex items-center justify-between rounded-xl bg-[#f0f9fa] border border-[#238D9D]/20 px-6 py-5">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Amount Due</p>
              <p className="text-4xl font-extrabold text-[#238D9D]">{fmtUSD(invoice.gross_cusd)} cUSD</p>
              <p className="text-sm text-gray-500 mt-1">{fmtKES(invoice.gross_cusd)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-400 mb-0.5">Billing Period</p>
              <p className="text-lg font-semibold text-gray-900">{monthLabel(invoice.period_month)}</p>
              <p className="text-sm text-gray-500 mt-0.5">{invoice.order_count} completed order{invoice.order_count !== 1 ? "s" : ""}</p>
            </div>
          </div>

          {/* Meta grid */}
          <div className="grid grid-cols-2 gap-5 mb-6">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Bill To</p>
              <div className="space-y-2.5">
                <Field label="Company" value="AkibaMiles Ltd" />
                <Field label="Network" value="Celo Mainnet" />
                <Field label="Accepted token" value="cUSD" />
              </div>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">From</p>
              <div className="space-y-2.5">
                <Field label="Merchant" value={partnerName} />
                <Field label="Period" value={monthLabel(invoice.period_month)} />
                {invoice.submitted_at && (
                  <Field label="Submitted" value={formatDate(invoice.submitted_at)} />
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          {invoice.notes && (
            <div className="mb-6 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">Merchant Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{invoice.notes}</p>
            </div>
          )}

          {/* AkibaMiles response */}
          {(invoice.status === "paid" || invoice.status === "rejected") && invoice.akiba_notes && (
            <div className={`mb-6 rounded-lg border px-4 py-3 ${invoice.status === "paid" ? "border-emerald-100 bg-emerald-50" : "border-red-100 bg-red-50"}`}>
              <p className={`text-[10px] font-semibold uppercase tracking-widest mb-2 ${invoice.status === "paid" ? "text-emerald-600" : "text-red-600"}`}>
                AkibaMiles {invoice.status === "paid" ? "Payment Reference" : "Rejection Reason"}
              </p>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{invoice.akiba_notes}</p>
              {invoice.resolved_at && (
                <p className="text-xs text-gray-400 mt-1">{formatDate(invoice.resolved_at)}</p>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="mt-8 border-t border-gray-100 pt-4 text-center text-[11px] text-gray-400">
            Generated by AkibaMiles Merchant Dashboard · {new Date().toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-gray-800">{value ?? "—"}</p>
    </div>
  );
}

// ── Order records modal ────────────────────────────────────────────────────────

function OrderRecordsModal({
  partnerName,
  onClose,
}: {
  partnerName: string;
  onClose: () => void;
}) {
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function fetchOrders() {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate, limit: "500" });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/merchant/orders?${params}`);
      const data = await res.json();
      setOrders(data.orders ?? []);
      setFetched(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleExportCSV() {
    setExporting(true);
    try {
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      if (statusFilter) params.set("status", statusFilter);
      const res = await fetch(`/api/merchant/invoices/export?${params}`);
      if (!res.ok) { alert("Export failed"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `orders-${fromDate}-to-${toDate}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-100 bg-white/95 backdrop-blur px-5 py-3">
          <span className="text-sm font-semibold text-gray-800">Order Records</span>
          <button onClick={onClose} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">From</label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-36 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">To</label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-36 text-sm" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-gray-600">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as OrderStatus | "")}
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">All statuses</option>
                {ORDER_STATUSES.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <Button onClick={fetchOrders} disabled={loading} className="self-end">
              {loading ? "Loading…" : "Search"}
            </Button>
            {fetched && (
              <Button variant="outline" onClick={handleExportCSV} disabled={exporting || orders.length === 0} className="self-end gap-1.5">
                <Download className="h-4 w-4" />
                {exporting ? "Exporting…" : `CSV (${orders.length})`}
              </Button>
            )}
          </div>

          {fetched && orders.length === 0 && (
            <p className="text-center py-8 text-sm text-gray-500">No orders found.</p>
          )}

          {orders.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-3">Invoice #</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Item</th>
                    <th className="px-4 py-3">Recipient</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{orderInvoiceNum(o.id)}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{o.created_at.slice(0, 10)}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900 max-w-[140px] truncate">{o.item_name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-gray-700">{o.recipient_name ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-gray-900">{fmtUSD(o.amount_cusd)}</td>
                      <td className="px-4 py-2.5"><StatusBadge status={o.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<PayoutInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerName, setPartnerName] = useState("Merchant");

  const [showCreate, setShowCreate] = useState(false);
  const [activeInvoice, setActiveInvoice] = useState<PayoutInvoice | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/merchant/payout-invoices").then((r) => r.json()),
      fetch("/api/auth/session").then((r) => r.json()),
    ]).then(([invData, sessionData]) => {
      setInvoices(invData.invoices ?? []);
      if (sessionData?.merchant?.partnerName) setPartnerName(sessionData.merchant.partnerName);
    }).finally(() => setLoading(false));
  }, []);

  function handleCreated(inv: PayoutInvoice) {
    setInvoices((prev) => [inv, ...prev]);
    setShowCreate(false);
    setActiveInvoice(inv);
  }

  function handleSubmitted(updated: PayoutInvoice) {
    setInvoices((prev) => prev.map((i) => i.id === updated.id ? updated : i));
    setActiveInvoice(updated);
  }

  // Summary stats
  const submitted = invoices.filter((i) => i.status === "submitted").length;
  const paid = invoices.filter((i) => i.status === "paid");
  const totalPaid = paid.reduce((s, i) => s + Number(i.gross_cusd), 0);
  const pending = invoices.filter((i) => i.status === "submitted").reduce((s, i) => s + Number(i.gross_cusd), 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Invoices"
        subtitle="Create and send monthly payout invoices to AkibaMiles"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* ── Action bar ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <Button onClick={() => setShowCreate(true)} className="gap-1.5">
              <Plus className="h-4 w-4" /> New Invoice
            </Button>
            <Button variant="outline" onClick={() => setShowRecords(true)} className="gap-1.5">
              <FileText className="h-4 w-4" /> Order Records
            </Button>
          </div>
          <p className="text-xs text-gray-400">
            Invoices are paid out monthly. Submit before the 5th of the following month.
          </p>
        </div>

        {/* ── Summary cards ── */}
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5">
              <p className="text-2xl font-bold text-gray-900">{submitted}</p>
              <p className="text-xs text-gray-500 mt-0.5">Awaiting Payment</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-2xl font-bold text-amber-600">{fmtUSD(pending)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Pending Payout</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5">
              <p className="text-2xl font-bold text-emerald-600">{fmtUSD(totalPaid)}</p>
              <p className="text-xs text-gray-500 mt-0.5">Total Paid Out ({paid.length} invoice{paid.length !== 1 ? "s" : ""})</p>
            </CardContent>
          </Card>
        </div>

        {/* ── Invoice list ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Payout Invoices</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">Loading…</p>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <FileText className="h-10 w-10 text-gray-200 mb-3" />
                <p className="text-sm font-medium text-gray-500">No invoices yet</p>
                <p className="text-xs text-gray-400 mt-1">
                  Click <span className="font-medium text-gray-600">New Invoice</span> to create your first monthly payout invoice.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {invoices.map((inv) => {
                  const expanded = expandedId === inv.id;
                  return (
                    <div key={inv.id}>
                      <div
                        className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : inv.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-semibold text-sm text-gray-900">
                              {monthLabel(inv.period_month)}
                            </span>
                            <span className="font-mono text-xs text-gray-400">{invoiceRef(inv)}</span>
                            <StatusPill status={inv.status} />
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {inv.order_count} order{inv.order_count !== 1 ? "s" : ""} · {fmtUSD(inv.gross_cusd)} cUSD
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setActiveInvoice(inv); }}
                            className="text-xs font-medium text-[#238D9D] hover:underline"
                          >
                            View
                          </button>
                          {expanded ? (
                            <ChevronUp className="h-4 w-4 text-gray-400" />
                          ) : (
                            <ChevronDown className="h-4 w-4 text-gray-400" />
                          )}
                        </div>
                      </div>

                      {/* Expanded row */}
                      {expanded && (
                        <div className="border-t border-gray-50 bg-gray-50/60 px-5 py-4">
                          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                            <div>
                              <p className="text-xs text-gray-400">Created</p>
                              <p className="font-medium text-gray-800 mt-0.5">{formatDate(inv.created_at)}</p>
                            </div>
                            {inv.submitted_at && (
                              <div>
                                <p className="text-xs text-gray-400">Submitted</p>
                                <p className="font-medium text-gray-800 mt-0.5">{formatDate(inv.submitted_at)}</p>
                              </div>
                            )}
                            {inv.resolved_at && (
                              <div>
                                <p className="text-xs text-gray-400">Resolved</p>
                                <p className="font-medium text-gray-800 mt-0.5">{formatDate(inv.resolved_at)}</p>
                              </div>
                            )}
                            {inv.notes && (
                              <div className="sm:col-span-2">
                                <p className="text-xs text-gray-400">Notes</p>
                                <p className="text-gray-700 mt-0.5 text-xs whitespace-pre-wrap">{inv.notes}</p>
                              </div>
                            )}
                            {inv.akiba_notes && (
                              <div className="sm:col-span-2">
                                <p className="text-xs text-gray-400">
                                  AkibaMiles {inv.status === "paid" ? "Payment Ref" : "Note"}
                                </p>
                                <p className="text-gray-700 mt-0.5 text-xs whitespace-pre-wrap">{inv.akiba_notes}</p>
                              </div>
                            )}
                          </div>
                          {inv.status === "draft" && (
                            <div className="mt-3">
                              <Button size="sm" onClick={() => setActiveInvoice(inv)} className="gap-1.5">
                                <Send className="h-3.5 w-3.5" /> Open &amp; Submit
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

      </div>

      {/* ── Modals ── */}
      {showCreate && (
        <CreateInvoiceModal onClose={() => setShowCreate(false)} onCreate={handleCreated} />
      )}
      {activeInvoice && (
        <PayoutInvoiceModal
          invoice={activeInvoice}
          partnerName={partnerName}
          onClose={() => setActiveInvoice(null)}
          onSubmit={handleSubmitted}
        />
      )}
      {showRecords && (
        <OrderRecordsModal partnerName={partnerName} onClose={() => setShowRecords(false)} />
      )}
    </div>
  );
}
