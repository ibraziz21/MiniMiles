"use client";

import { useState, useEffect, useRef } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FileText,
  CheckCircle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronUp,
  X,
  Printer,
  Download,
  TrendingUp,
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
import type { PayoutInvoice, MerchantOrder, OrderStatus } from "@/types";
import { ORDER_STATUSES } from "@/types";
import { formatDate } from "@/lib/utils";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { Input } from "@/components/ui/input";

// ── constants ─────────────────────────────────────────────────────────────────

const SUBSCRIPTION_FEE = 20.00;
const SERVICE_FEE_RATE = 0.02;

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtUSD(val: number | null | undefined) {
  if (val == null) return "—";
  return `$${Number(val).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtKES(val: number | null | undefined, rate: number) {
  if (val == null) return "—";
  return `KES ${Math.round(Number(val) * rate).toLocaleString("en-KE")}`;
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

function billRef(inv: PayoutInvoice) {
  return `BILL-${inv.period_month}-${inv.id.slice(0, 6).toUpperCase()}`;
}

function orderInvoiceNum(id: string) {
  return `INV-${id.slice(0, 8).toUpperCase()}`;
}

function daysInMonth(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function dayOfMonth() {
  return new Date().getDate();
}

// ── Status pill ───────────────────────────────────────────────────────────────

const STATUS_META: Record<PayoutInvoice["status"], { label: string; icon: React.ReactNode; cls: string }> = {
  draft:     { label: "Pending",   icon: <Clock className="h-3.5 w-3.5" />,       cls: "bg-gray-100 text-gray-600" },
  submitted: { label: "Submitted", icon: <Clock className="h-3.5 w-3.5" />,       cls: "bg-amber-50 text-amber-700" },
  paid:      { label: "Paid",      icon: <CheckCircle className="h-3.5 w-3.5" />, cls: "bg-emerald-50 text-emerald-700" },
  rejected:  { label: "Rejected",  icon: <XCircle className="h-3.5 w-3.5" />,     cls: "bg-red-50 text-red-700" },
};

function StatusPill({ status }: { status: PayoutInvoice["status"] }) {
  const { label, icon, cls } = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>
      {icon}{label}
    </span>
  );
}

// ── Month-to-date progress card ───────────────────────────────────────────────

function MonthProgressCard({
  currentMonthRevenue,
  lastMonthRevenue,
  currentMonthOrders,
  kesRate,
}: {
  currentMonthRevenue: number;
  lastMonthRevenue: number;
  currentMonthOrders: number;
  kesRate: number;
}) {
  const ym = currentMonth();
  const total = daysInMonth(ym);
  const elapsed = Math.min(dayOfMonth(), total);
  const progress = Math.round((elapsed / total) * 100);
  const projected = elapsed > 0 ? (currentMonthRevenue / elapsed) * total : 0;
  const vsLast = lastMonthRevenue > 0
    ? ((currentMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100
    : null;

  return (
    <Card className="col-span-2">
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-1">
              {monthLabel(ym)} · Month-to-Date Revenue
            </p>
            <p className="text-3xl font-extrabold text-gray-900">{fmtUSD(currentMonthRevenue)}</p>
            <p className="text-sm text-gray-500 mt-0.5">{fmtKES(currentMonthRevenue, kesRate)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 mb-0.5">{currentMonthOrders} completed order{currentMonthOrders !== 1 ? "s" : ""}</p>
            {vsLast !== null && (
              <span className={`inline-flex items-center gap-1 text-xs font-semibold ${vsLast >= 0 ? "text-emerald-600" : "text-red-500"}`}>
                {vsLast >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <ArrowDownCircle className="h-3.5 w-3.5" />}
                {vsLast >= 0 ? "+" : ""}{vsLast.toFixed(1)}% vs last month
              </span>
            )}
            {projected > 0 && (
              <p className="text-xs text-gray-400 mt-1">Projected: {fmtUSD(projected)}</p>
            )}
          </div>
        </div>
        <div>
          <div className="flex justify-between text-[11px] text-gray-400 mb-1">
            <span>Day {elapsed} of {total}</span>
            <span>{progress}% of month elapsed</span>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className="h-2 rounded-full bg-[#238D9D] transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Bill detail modal ─────────────────────────────────────────────────────────

function BillModal({
  invoice,
  partnerName,
  kesRate,
  onClose,
}: {
  invoice: PayoutInvoice;
  partnerName: string;
  kesRate: number;
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  // Use stored fee values; fall back to computing from gross for old rows missing fee columns
  const gross        = Number(invoice.gross_cusd ?? 0);
  const subFee       = Number(invoice.subscription_fee_cusd ?? SUBSCRIPTION_FEE);
  const serviceFee   = Number(invoice.service_fee_cusd ?? Math.round(gross * SERVICE_FEE_RATE * 100) / 100);
  const net          = Number(invoice.net_cusd ?? Math.max(0, Math.round((gross - subFee - serviceFee) * 100) / 100));

  function handlePrint() {
    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const win = window.open("", "_blank", "width=800,height=1000");
    if (!win) return;
    win.document.write(`<!DOCTYPE html><html><head>
      <title>${billRef(invoice)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #111; }
        .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #238D9D; }
        .brand { font-size: 22px; font-weight: 800; color: #238D9D; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th, td { padding: 10px 14px; text-align: left; font-size: 13px; }
        thead th { background: #f5f5f5; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #888; }
        tbody tr { border-bottom: 1px solid #f0f0f0; }
        .net-row td { font-weight: 700; font-size: 15px; border-top: 2px solid #238D9D; padding-top: 14px; }
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
          <span className="text-sm font-semibold text-gray-800">{billRef(invoice)}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1.5">
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </Button>
            <button onClick={onClose} className="ml-1 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Bill content */}
        <div ref={printRef} className="p-8">
          {/* Header */}
          <div className="flex justify-between items-start mb-8 pb-6 border-b-2 border-[#238D9D]">
            <div>
              <p className="text-xl font-extrabold text-[#238D9D]">AkibaMiles</p>
              <p className="text-xs text-gray-500 mt-0.5">Merchant Partner Billing</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-bold text-gray-900">{billRef(invoice)}</p>
              <p className="text-sm text-gray-500 mt-0.5">{monthLabel(invoice.period_month)}</p>
              <div className="mt-2"><StatusPill status={invoice.status} /></div>
            </div>
          </div>

          {/* Parties */}
          <div className="grid grid-cols-2 gap-5 mb-8">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Billed To</p>
              <p className="text-sm font-semibold text-gray-900">{partnerName}</p>
              <p className="text-xs text-gray-500 mt-0.5">AkibaMiles Merchant Partner</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">Issued By</p>
              <p className="text-sm font-semibold text-gray-900">AkibaMiles Ltd</p>
              <p className="text-xs text-gray-500 mt-0.5">Celo Mainnet · cUSD</p>
            </div>
          </div>

          {/* Fee breakdown table */}
          <table className="w-full text-sm mb-6">
            <thead>
              <tr className="border-b border-gray-100 text-left text-[10px] font-semibold uppercase tracking-widest text-gray-400">
                <th className="pb-2.5">Description</th>
                <th className="pb-2.5 text-right">cUSD</th>
                <th className="pb-2.5 text-right">KES</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              <tr>
                <td className="py-3 text-gray-800">
                  Gross revenue — {invoice.order_count} completed order{invoice.order_count !== 1 ? "s" : ""}
                </td>
                <td className="py-3 text-right font-medium text-gray-900">{fmtUSD(gross)}</td>
                <td className="py-3 text-right text-gray-500">{fmtKES(gross, kesRate)}</td>
              </tr>
              <tr>
                <td className="py-3 text-gray-600">
                  Platform subscription fee
                </td>
                <td className="py-3 text-right font-medium text-red-600">−{fmtUSD(subFee)}</td>
                <td className="py-3 text-right text-gray-400">−{fmtKES(subFee, kesRate)}</td>
              </tr>
              <tr>
                <td className="py-3 text-gray-600">
                  Service fee ({(SERVICE_FEE_RATE * 100).toFixed(0)}% of gross)
                </td>
                <td className="py-3 text-right font-medium text-red-600">−{fmtUSD(serviceFee)}</td>
                <td className="py-3 text-right text-gray-400">−{fmtKES(serviceFee, kesRate)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#238D9D]">
                <td className="pt-4 font-bold text-gray-900">Net payout to merchant</td>
                <td className="pt-4 text-right text-xl font-extrabold text-[#238D9D]">{fmtUSD(net)}</td>
                <td className="pt-4 text-right font-semibold text-gray-600">{fmtKES(net, kesRate)}</td>
              </tr>
            </tfoot>
          </table>

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

          {invoice.status === "draft" && (
            <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 text-xs text-gray-500">
              This bill covers the current month and will be finalised at month-end. AkibaMiles processes payouts automatically — no action needed from you.
            </div>
          )}

          <div className="mt-8 border-t border-gray-100 pt-4 text-center text-[11px] text-gray-400">
            Generated by AkibaMiles Merchant Dashboard · {new Date().toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Order records modal ────────────────────────────────────────────────────────

function OrderRecordsModal({ onClose }: { onClose: () => void }) {
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
                    <th className="px-4 py-3">Order #</th>
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

interface PageStats {
  currentMonthRevenue: number;
  lastMonthRevenue: number;
  currentMonthOrders: number;
  pendingCusd: number;
  totalPaidCusd: number;
  paidCount: number;
  submittedCount: number;
}

export default function BillingPage() {
  const [invoices, setInvoices] = useState<PayoutInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerName, setPartnerName] = useState("Merchant");
  const [kesRate, setKesRate] = useState(130);
  const [stats, setStats] = useState<PageStats | null>(null);
  const [activeBill, setActiveBill] = useState<PayoutInvoice | null>(null);
  const [showRecords, setShowRecords] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/merchant/payout-invoices").then((r) => r.json()),
      fetch("/api/auth/session").then((r) => r.json()),
      fetch("/api/merchant/settings").then((r) => r.json()),
      fetch("/api/merchant/finance").then((r) => r.json()),
    ]).then(([invData, sessionData, settingsData, financeData]) => {
      const invList: PayoutInvoice[] = invData.invoices ?? [];
      setInvoices(invList);

      if (sessionData?.merchant?.partnerName) setPartnerName(sessionData.merchant.partnerName);
      if (settingsData?.settings?.kes_exchange_rate) setKesRate(Number(settingsData.settings.kes_exchange_rate));

      const monthly: Array<{ month: string; revenue_cusd: number; order_count: number }> =
        financeData?.monthly ?? [];
      const cm = currentMonth();
      const lastMo = (() => {
        const [y, m] = cm.split("-").map(Number);
        return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
      })();
      const cmBucket  = monthly.find((b) => b.month === cm);
      const lastBucket = monthly.find((b) => b.month === lastMo);

      const paidInvs      = invList.filter((i) => i.status === "paid");
      const submittedInvs = invList.filter((i) => i.status === "submitted");

      setStats({
        currentMonthRevenue: cmBucket?.revenue_cusd ?? 0,
        lastMonthRevenue:    lastBucket?.revenue_cusd ?? 0,
        currentMonthOrders:  cmBucket?.order_count ?? 0,
        pendingCusd:    submittedInvs.reduce((s, i) => s + Number(i.net_cusd ?? 0), 0),
        totalPaidCusd:  paidInvs.reduce((s, i) => s + Number(i.net_cusd ?? 0), 0),
        paidCount:      paidInvs.length,
        submittedCount: submittedInvs.length,
      });
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Billing"
        subtitle="Monthly bills are auto-generated. AkibaMiles processes payouts — no action needed."
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* ── Action bar ── */}
        <div className="flex items-center justify-end">
          <Button variant="outline" onClick={() => setShowRecords(true)} className="gap-1.5">
            <FileText className="h-4 w-4" /> Order Records
          </Button>
        </div>

        {/* ── Summary cards ── */}
        {!loading && stats && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MonthProgressCard
              currentMonthRevenue={stats.currentMonthRevenue}
              lastMonthRevenue={stats.lastMonthRevenue}
              currentMonthOrders={stats.currentMonthOrders}
              kesRate={kesRate}
            />

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowUpCircle className="h-4 w-4 text-emerald-500" />
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Received</p>
                </div>
                <p className="text-2xl font-bold text-emerald-600">{fmtUSD(stats.totalPaidCusd)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{fmtKES(stats.totalPaidCusd, kesRate)}</p>
                <p className="text-xs text-gray-400 mt-1">net · {stats.paidCount} bill{stats.paidCount !== 1 ? "s" : ""} paid</p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-1">
                  <ArrowDownCircle className="h-4 w-4 text-amber-500" />
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Awaiting Payout</p>
                </div>
                <p className="text-2xl font-bold text-amber-600">{fmtUSD(stats.pendingCusd)}</p>
                <p className="text-xs text-gray-400 mt-0.5">{fmtKES(stats.pendingCusd, kesRate)}</p>
                <p className="text-xs text-gray-400 mt-1">net · {stats.submittedCount} bill{stats.submittedCount !== 1 ? "s" : ""} pending</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Fee info banner ── */}
        <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500 flex items-center gap-3">
          <span className="shrink-0 rounded-full bg-[#238D9D]/10 px-2.5 py-1 text-[#238D9D] font-semibold">Fee structure</span>
          Platform subscription: <strong className="text-gray-700">$20.00 / month</strong>
          &nbsp;·&nbsp;
          Service fee: <strong className="text-gray-700">2% of gross revenue</strong>
          &nbsp;·&nbsp;
          Net = Gross − both fees
        </div>

        {/* ── Bills list ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Billing History</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <p className="px-5 py-8 text-center text-sm text-gray-400">Loading…</p>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <FileText className="h-10 w-10 text-gray-200 mb-3" />
                <p className="text-sm font-medium text-gray-500">No bills yet</p>
                <p className="text-xs text-gray-400 mt-1">Your first bill will appear here automatically.</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50">
                {invoices.map((inv) => {
                  const expanded = expandedId === inv.id;
                  const net = Number(inv.net_cusd ?? 0);
                  return (
                    <div key={inv.id}>
                      <div
                        className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 cursor-pointer"
                        onClick={() => setExpandedId(expanded ? null : inv.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-semibold text-sm text-gray-900">{monthLabel(inv.period_month)}</span>
                            <span className="font-mono text-xs text-gray-400">{billRef(inv)}</span>
                            <StatusPill status={inv.status} />
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {inv.order_count} order{inv.order_count !== 1 ? "s" : ""} · Gross {fmtUSD(inv.gross_cusd)} · Net payout {fmtUSD(net)} · {fmtKES(net, kesRate)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={(e) => { e.stopPropagation(); setActiveBill(inv); }}
                            className="text-xs font-medium text-[#238D9D] hover:underline"
                          >
                            View
                          </button>
                          {expanded
                            ? <ChevronUp className="h-4 w-4 text-gray-400" />
                            : <ChevronDown className="h-4 w-4 text-gray-400" />
                          }
                        </div>
                      </div>

                      {expanded && (
                        <div className="border-t border-gray-50 bg-gray-50/60 px-5 py-4">
                          {/* Inline fee breakdown */}
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3 text-sm">
                            <div>
                              <p className="text-xs text-gray-400">Gross revenue</p>
                              <p className="font-medium text-gray-800 mt-0.5">{fmtUSD(inv.gross_cusd)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400">Subscription fee</p>
                              <p className="font-medium text-red-600 mt-0.5">−{fmtUSD(inv.subscription_fee_cusd)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400">Service fee (2%)</p>
                              <p className="font-medium text-red-600 mt-0.5">−{fmtUSD(inv.service_fee_cusd)}</p>
                            </div>
                            <div>
                              <p className="text-xs text-gray-400">Net payout</p>
                              <p className="font-bold text-[#238D9D] mt-0.5">{fmtUSD(net)}</p>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-xs text-gray-400">Bill date</p>
                              <p className="font-medium text-gray-800 mt-0.5">{formatDate(inv.created_at)}</p>
                            </div>
                            {inv.resolved_at && (
                              <div>
                                <p className="text-xs text-gray-400">Paid</p>
                                <p className="font-medium text-gray-800 mt-0.5">{formatDate(inv.resolved_at)}</p>
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

      {activeBill && (
        <BillModal
          invoice={activeBill}
          partnerName={partnerName}
          kesRate={kesRate}
          onClose={() => setActiveBill(null)}
        />
      )}
      {showRecords && <OrderRecordsModal onClose={() => setShowRecords(false)} />}
    </div>
  );
}
