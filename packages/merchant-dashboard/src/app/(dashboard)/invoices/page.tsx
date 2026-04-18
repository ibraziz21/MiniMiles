"use client";

import { useState, useEffect, useRef } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { formatDate } from "@/lib/utils";
import type { MerchantOrder, OrderStatus } from "@/types";
import { ORDER_STATUSES } from "@/types";
import {
  Download,
  FileText,
  Printer,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ── helpers ──────────────────────────────────────────────────────────────────

function fmtUSD(val: number | null | undefined) {
  if (val == null) return "—";
  return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtKES(val: number | null | undefined) {
  if (val == null) return "—";
  return `KES ${val.toLocaleString("en-KE")}`;
}

function invoiceNum(id: string) {
  return `INV-${id.slice(0, 8).toUpperCase()}`;
}

// ── Single-order Invoice modal ─────────────────────────────────────────────

function InvoiceModal({
  order,
  partnerName,
  onClose,
}: {
  order: MerchantOrder;
  partnerName: string;
  onClose: () => void;
}) {
  const printRef = useRef<HTMLDivElement>(null);

  function handlePrint() {
    if (!printRef.current) return;
    const content = printRef.current.innerHTML;
    const win = window.open("", "_blank", "width=800,height=1000");
    if (!win) return;
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${invoiceNum(order.id)}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 40px; color: #111; }
            .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 24px; border-bottom: 2px solid #238D9D; }
            .brand { font-size: 22px; font-weight: 800; color: #238D9D; }
            .brand-sub { font-size: 12px; color: #666; margin-top: 2px; }
            .inv-meta { text-align: right; }
            .inv-num { font-size: 20px; font-weight: 700; }
            .inv-date { font-size: 12px; color: #666; margin-top: 4px; }
            .section { margin-bottom: 24px; }
            .section-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #666; margin-bottom: 10px; }
            .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
            .field label { font-size: 11px; color: #888; }
            .field p { font-size: 13px; font-weight: 500; margin-top: 2px; }
            .field p.mono { font-family: monospace; font-size: 11px; word-break: break-all; }
            .amount-box { background: #f0f9fa; border: 1px solid #238D9D33; border-radius: 8px; padding: 16px; display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; }
            .amount-box .cusd { font-size: 28px; font-weight: 800; color: #238D9D; }
            .amount-box .kes { font-size: 14px; color: #555; margin-top: 4px; }
            .status-pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; background: #e0f2f4; color: #238D9D; }
            .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #eee; font-size: 11px; color: #999; text-align: center; }
            @media print { body { padding: 20px; } }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
        {/* Toolbar */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white/95 backdrop-blur px-5 py-3">
          <span className="text-sm font-semibold text-gray-800">{invoiceNum(order.id)}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1.5">
              <Printer className="h-3.5 w-3.5" /> Print / Save PDF
            </Button>
            <button onClick={onClose} className="ml-1 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Invoice content */}
        <div ref={printRef} className="p-8">
          {/* Header */}
          <div className="header flex justify-between items-start mb-8 pb-6 border-b-2 border-[#238D9D]">
            <div>
              <p className="text-xl font-extrabold text-[#238D9D]">{partnerName}</p>
              <p className="text-xs text-gray-500 mt-0.5">AkibaMiles Merchant</p>
            </div>
            <div className="text-right">
              <p className="inv-num text-lg font-bold text-gray-900">{invoiceNum(order.id)}</p>
              <p className="inv-date text-xs text-gray-500 mt-1">
                Issued: {formatDate(order.created_at)}
              </p>
              <span className="mt-1.5 inline-block rounded-full bg-[#e0f2f4] px-2.5 py-0.5 text-xs font-semibold text-[#238D9D]">
                {order.status.replace(/_/g, " ").toUpperCase()}
              </span>
            </div>
          </div>

          {/* Amount */}
          <div className="amount-box mb-6 flex items-center justify-between rounded-xl bg-[#f0f9fa] border border-[#238D9D]/20 px-5 py-4">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wider">Amount</p>
              <p className="text-3xl font-extrabold text-[#238D9D] mt-0.5">
                {fmtUSD(order.amount_cusd)} {order.payment_currency ?? "cUSD"}
              </p>
              {order.amount_kes != null && (
                <p className="text-sm text-gray-500 mt-0.5">{fmtKES(order.amount_kes)}</p>
              )}
            </div>
            {order.payment_ref && (
              <div className="text-right">
                <p className="text-xs text-gray-400">Payment Ref</p>
                <p className="text-xs font-mono text-gray-700 mt-0.5 max-w-[180px] break-all">
                  {order.payment_ref}
                </p>
              </div>
            )}
          </div>

          {/* Two columns: item + delivery */}
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <p className="section-title text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
                Item Details
              </p>
              <div className="space-y-3">
                <Field label="Item" value={order.item_name} />
                <Field label="Category" value={order.item_category} />
                {order.voucher_code && (
                  <Field label="Voucher Code" value={order.voucher_code} mono />
                )}
              </div>
            </div>
            <div>
              <p className="section-title text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-3">
                Delivery
              </p>
              <div className="space-y-3">
                <Field label="Recipient" value={order.recipient_name} />
                <Field label="Phone" value={order.phone} />
                <Field label="City" value={order.city} />
                <Field label="Address" value={order.location_details} />
              </div>
            </div>
          </div>

          {/* Customer wallet */}
          <div className="mb-6">
            <p className="section-title text-[10px] font-semibold uppercase tracking-widest text-gray-400 mb-2">
              Customer
            </p>
            <p className="font-mono text-xs text-gray-600 break-all">{order.user_address}</p>
          </div>

          {/* Footer */}
          <div className="mt-8 border-t border-gray-100 pt-4 text-center text-[11px] text-gray-400">
            Generated by AkibaMiles Merchant Dashboard · {new Date().toLocaleDateString()}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <p className="text-[11px] text-gray-400">{label}</p>
      <p className={`mt-0.5 text-sm text-gray-800 ${mono ? "font-mono text-xs break-all" : "font-medium"}`}>
        {value ?? "—"}
      </p>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

const PAGE_SIZE = 20;

export default function InvoicesPage() {
  // Filters
  const [fromDate, setFromDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().slice(0, 10);
  });
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "">("");
  const [search, setSearch] = useState("");

  // Data
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [partnerName, setPartnerName] = useState("Merchant");

  // Pagination
  const [page, setPage] = useState(1);

  // Invoice modal
  const [invoiceOrder, setInvoiceOrder] = useState<MerchantOrder | null>(null);

  // CSV export loading
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => { if (d.merchant?.partnerName) setPartnerName(d.merchant.partnerName); });
  }, []);

  async function fetchOrders() {
    setLoading(true);
    setPage(1);
    try {
      const params = new URLSearchParams({
        from: fromDate,
        to: toDate,
        limit: "500",
      });
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

  // Search filter (client-side)
  const filtered = orders.filter((o) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (o.item_name ?? "").toLowerCase().includes(s) ||
      (o.recipient_name ?? "").toLowerCase().includes(s) ||
      (o.city ?? "").toLowerCase().includes(s) ||
      (o.payment_ref ?? "").toLowerCase().includes(s) ||
      o.id.toLowerCase().includes(s)
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageOrders = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Summary stats
  const totalValue = orders.reduce((s, o) => s + (o.amount_cusd ?? 0), 0);
  const completedOrders = orders.filter((o) =>
    ["delivered", "received", "completed"].includes(o.status)
  );
  const completedValue = completedOrders.reduce((s, o) => s + (o.amount_cusd ?? 0), 0);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Invoices & Records"
        subtitle="Generate invoices and export order records"
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">

        {/* ── Filters ── */}
        <Card>
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">From</label>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-36 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-600">To</label>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-36 text-sm"
                />
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
                    <option key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <Button onClick={fetchOrders} disabled={loading} className="self-end">
                {loading ? "Loading…" : "Search"}
              </Button>
              {fetched && (
                <Button
                  variant="outline"
                  onClick={handleExportCSV}
                  disabled={exporting || orders.length === 0}
                  className="self-end gap-1.5"
                >
                  <Download className="h-4 w-4" />
                  {exporting ? "Exporting…" : `Export CSV (${orders.length})`}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Summary cards ── */}
        {fetched && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: "Orders Found", value: String(orders.length) },
              { label: "Total Value", value: fmtUSD(Math.round(totalValue * 100) / 100) },
              { label: "Completed Orders", value: String(completedOrders.length) },
              { label: "Settled Value", value: fmtUSD(Math.round(completedValue * 100) / 100) },
            ].map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="pt-4 pb-4">
                  <p className="text-xl font-bold text-gray-900">{value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* ── Orders table ── */}
        {fetched && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <CardTitle className="text-sm">
                  {filtered.length} order{filtered.length !== 1 ? "s" : ""}
                  {search && ` matching "${search}"`}
                </CardTitle>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                  <Input
                    placeholder="Search item, recipient, ref…"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-8 h-8 text-sm w-56"
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filtered.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-gray-500">
                  No orders found for the selected filters.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                          <th className="px-5 py-3">Invoice #</th>
                          <th className="px-5 py-3">Date</th>
                          <th className="px-5 py-3">Item</th>
                          <th className="px-5 py-3">Recipient</th>
                          <th className="px-5 py-3">City</th>
                          <th className="px-5 py-3 text-right">Amount</th>
                          <th className="px-5 py-3">Status</th>
                          <th className="px-5 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {pageOrders.map((order) => (
                          <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-5 py-3 font-mono text-xs text-gray-500">
                              {invoiceNum(order.id)}
                            </td>
                            <td className="px-5 py-3 text-xs text-gray-500">
                              {order.created_at.slice(0, 10)}
                            </td>
                            <td className="px-5 py-3 font-medium text-gray-900 max-w-[160px] truncate">
                              {order.item_name ?? "—"}
                            </td>
                            <td className="px-5 py-3 text-gray-700">{order.recipient_name ?? "—"}</td>
                            <td className="px-5 py-3 text-gray-500">{order.city ?? "—"}</td>
                            <td className="px-5 py-3 text-right font-semibold text-gray-900">
                              {fmtUSD(order.amount_cusd)}
                            </td>
                            <td className="px-5 py-3">
                              <StatusBadge status={order.status} />
                            </td>
                            <td className="px-5 py-3">
                              <button
                                onClick={() => setInvoiceOrder(order)}
                                className="flex items-center gap-1 text-xs font-medium text-[#238D9D] hover:underline"
                              >
                                <FileText className="h-3.5 w-3.5" />
                                Invoice
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
                      <span className="text-xs text-gray-500">
                        Page {page} of {totalPages} · {filtered.length} records
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page === 1}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                        >
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page === totalPages}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
                        >
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}

        {!fetched && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-10 w-10 text-gray-200 mb-3" />
            <p className="text-sm font-medium text-gray-500">Select a date range and click Search</p>
            <p className="text-xs text-gray-400 mt-1">
              You can then generate individual invoices or export all records as CSV
            </p>
          </div>
        )}
      </div>

      {/* Invoice modal */}
      {invoiceOrder && (
        <InvoiceModal
          order={invoiceOrder}
          partnerName={partnerName}
          onClose={() => setInvoiceOrder(null)}
        />
      )}
    </div>
  );
}
