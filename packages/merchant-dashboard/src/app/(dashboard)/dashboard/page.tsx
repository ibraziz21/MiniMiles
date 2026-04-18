"use client";

import { useState, useEffect } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/orders/StatusBadge";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import type { OrderStatsResponse, OrderStatus, MonthlyFinanceBucket } from "@/types";
import { ORDER_STATUSES } from "@/types";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  Tag,
  Package,
  ShoppingBag,
  ChevronLeft,
  ChevronRight,
  CheckCircle,
} from "lucide-react";

// ── helpers ─────────────────────────────────────────────────────────────────

function fmtUSD(val: number) {
  return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", {
    month: "long",
    year: "numeric",
  });
}

function currentYM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// ── Month picker ──────────────────────────────────────────────────────────────

function MonthPicker({
  months,
  selected,
  onChange,
}: {
  months: string[];
  selected: string;
  onChange: (m: string) => void;
}) {
  const idx = months.indexOf(selected);
  const canPrev = idx < months.length - 1;
  const canNext = idx > 0;
  const isCurrentMonth = selected === currentYM();

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => canPrev && onChange(months[idx + 1])}
        disabled={!canPrev}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <span className="min-w-[140px] text-center text-sm font-semibold text-gray-900">
        {monthLabel(selected)}
        {isCurrentMonth && (
          <span className="ml-1.5 inline-block rounded-full bg-[#238D9D]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#238D9D]">
            current
          </span>
        )}
      </span>

      <button
        onClick={() => canNext && onChange(months[idx - 1])}
        disabled={!canNext}
        className="flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ── Finance panel (top section) ────────────────────────────────────────────────

function FinancePanel({
  bucket,
  prevBucket,
  isCurrentMonth,
}: {
  bucket: MonthlyFinanceBucket;
  prevBucket: MonthlyFinanceBucket | null;
  isCurrentMonth: boolean;
}) {
  const momPct =
    prevBucket && prevBucket.value_sold_cusd > 0
      ? Math.round(
          ((bucket.value_sold_cusd - prevBucket.value_sold_cusd) /
            prevBucket.value_sold_cusd) *
            100,
        )
      : null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {/* Items sold */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#238D9D]/10">
              <ShoppingBag className="h-5 w-5 text-[#238D9D]" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900">{bucket.items_sold}</p>
              <p className="text-xs text-gray-500">Items Sold</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Value sold */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900">{fmtUSD(bucket.value_sold_cusd)}</p>
              <p className="text-xs text-gray-500">Value Sold</p>
              {momPct !== null && (
                <span
                  className={`inline-flex items-center gap-0.5 mt-1 text-xs font-medium ${
                    momPct >= 0 ? "text-green-600" : "text-red-500"
                  }`}
                >
                  {momPct >= 0 ? (
                    <TrendingUp className="h-3 w-3" />
                  ) : (
                    <TrendingDown className="h-3 w-3" />
                  )}
                  {momPct >= 0 ? "+" : ""}
                  {momPct}% vs prev month
                </span>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Current month: estimated to receive / Past month: settled */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <div
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                isCurrentMonth ? "bg-amber-50" : "bg-green-50"
              }`}
            >
              {isCurrentMonth ? (
                <Clock className="h-5 w-5 text-amber-600" />
              ) : (
                <CheckCircle className="h-5 w-5 text-green-600" />
              )}
            </div>
            <div className="min-w-0">
              {isCurrentMonth ? (
                <>
                  <p className="text-2xl font-bold text-gray-900">
                    {fmtUSD(bucket.in_flight_cusd)}
                  </p>
                  <p className="text-xs text-gray-500">Est. to Receive</p>
                  <p className="text-xs text-gray-400">In-transit orders</p>
                </>
              ) : (
                <>
                  <p className="text-2xl font-bold text-gray-900">
                    {fmtUSD(bucket.value_sold_cusd)}
                  </p>
                  <p className="text-xs text-gray-500">Amount Settled</p>
                  <p className="text-xs text-gray-400">Completed orders</p>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vouchers used */}
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50">
              <Tag className="h-5 w-5 text-purple-600" />
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-gray-900">{bucket.vouchers_used}</p>
              <p className="text-xs text-gray-500">Vouchers Used</p>
              {bucket.items_sold > 0 && (
                <p className="text-xs text-gray-400">
                  {Math.round((bucket.vouchers_used / bucket.items_sold) * 100)}% of orders
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [stats, setStats] = useState<OrderStatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(currentYM());

  useEffect(() => {
    fetch("/api/merchant/stats")
      .then((r) => r.json())
      .then((d: OrderStatsResponse) => {
        setStats(d);
        setSelectedMonth(currentYM());
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title="Dashboard" subtitle="Loading…" />
        <div className="flex-1 flex items-center justify-center text-sm text-gray-400">
          Loading dashboard…
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title="Dashboard" subtitle="" />
        <div className="flex-1 flex items-center justify-center text-sm text-red-500">
          Failed to load dashboard.
        </div>
      </div>
    );
  }

  const months = (stats.monthly ?? []).map((m) => m.month);
  const bucketMap = Object.fromEntries((stats.monthly ?? []).map((m) => [m.month, m]));

  const selectedBucket: MonthlyFinanceBucket = bucketMap[selectedMonth] ?? {
    month: selectedMonth,
    items_sold: 0,
    value_sold_cusd: 0,
    in_flight_cusd: 0,
    vouchers_used: 0,
  };

  // Previous month relative to the selected one
  const selIdx = months.indexOf(selectedMonth);
  const prevBucket = selIdx >= 0 && selIdx < months.length - 1 ? bucketMap[months[selIdx + 1]] ?? null : null;

  const isCurrentMonth = selectedMonth === currentYM();
  const totalOrders = Object.values(stats.by_status).reduce((a, b) => a + b, 0);
  const vs = stats.voucher_stats;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar
        title="Dashboard"
        subtitle={`${stats.new_orders} new order${stats.new_orders !== 1 ? "s" : ""} waiting`}
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── 1. Monthly Finance Panel ─────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
              Financials
            </h2>
            {months.length > 0 && (
              <MonthPicker
                months={months}
                selected={selectedMonth}
                onChange={setSelectedMonth}
              />
            )}
          </div>
          <FinancePanel
            bucket={selectedBucket}
            prevBucket={prevBucket}
            isCurrentMonth={isCurrentMonth}
          />
          <div className="mt-2 flex justify-end">
            <Link href="/finance" className="text-xs font-medium text-[#238D9D] hover:underline">
              Full finance report →
            </Link>
          </div>
        </div>

        {/* ── 2. Voucher Summary ───────────────────────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
            Vouchers
          </h2>
          <div className="grid grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                    <Tag className="h-4 w-4 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-900">{vs.outstanding_issued}</p>
                    <p className="text-xs text-gray-500">Outstanding</p>
                    <p className="text-xs text-gray-400">Issued, not redeemed</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#238D9D]/10">
                    <Tag className="h-4 w-4 text-[#238D9D]" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-gray-900">{vs.active_templates}</p>
                    <p className="text-xs text-gray-500">Active Templates</p>
                    <p className="text-xs text-gray-400">Redeemable by users</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      vs.expiring_soon > 0 ? "bg-red-50" : "bg-gray-50"
                    }`}
                  >
                    <Clock
                      className={`h-4 w-4 ${vs.expiring_soon > 0 ? "text-red-500" : "text-gray-400"}`}
                    />
                  </div>
                  <div>
                    <p
                      className={`text-xl font-bold ${
                        vs.expiring_soon > 0 ? "text-red-600" : "text-gray-900"
                      }`}
                    >
                      {vs.expiring_soon}
                    </p>
                    <p className="text-xs text-gray-500">Expiring Soon</p>
                    <p className="text-xs text-gray-400">Within 30 days</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="mt-2 flex justify-end">
            <Link href="/vouchers" className="text-xs font-medium text-[#238D9D] hover:underline">
              Manage vouchers →
            </Link>
          </div>
        </div>

        {/* ── 3. Orders breakdown + Recent orders ─────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
            Orders
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {/* Status breakdown */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">By Status</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {ORDER_STATUSES.map((status) => {
                    const count = stats.by_status[status];
                    const pct = totalOrders > 0 ? Math.round((count / totalOrders) * 100) : 0;
                    return (
                      <div key={status} className="flex items-center gap-3">
                        <StatusBadge status={status} />
                        <div className="flex-1 overflow-hidden rounded-full bg-gray-100 h-2">
                          <div
                            className="h-2 rounded-full bg-[#238D9D] transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-8 text-right text-sm font-medium text-gray-700">
                          {count}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-xs text-gray-400">
                  <span>Total: {totalOrders} orders</span>
                  <Link href="/orders" className="font-medium text-[#238D9D] hover:underline">
                    View all →
                  </Link>
                </div>
              </CardContent>
            </Card>

            {/* Recent orders */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Recent Orders</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {stats.recent_orders.length === 0 ? (
                  <p className="px-5 pb-5 text-sm text-gray-500">No orders yet.</p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {stats.recent_orders.slice(0, 7).map((order) => (
                      <li key={order.id}>
                        <Link
                          href={`/orders/${order.id}`}
                          className="flex items-center justify-between px-5 py-2.5 hover:bg-gray-50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-sm font-medium text-gray-900">
                                {order.item_name ?? "Order"}
                              </p>
                              {order.amount_cusd != null && (
                                <span className="shrink-0 text-xs font-semibold text-gray-700">
                                  {fmtUSD(order.amount_cusd)}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-500">
                              {order.recipient_name} · {order.city} ·{" "}
                              {formatDate(order.created_at)}
                            </p>
                          </div>
                          <div className="ml-3 shrink-0">
                            <StatusBadge status={order.status} />
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
                {stats.recent_orders.length > 0 && (
                  <div className="px-5 py-3 border-t border-gray-100">
                    <Link
                      href="/orders"
                      className="text-xs font-medium text-[#238D9D] hover:underline"
                    >
                      View all orders →
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── 4. Stock ─────────────────────────────────────────────────────── */}
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400 mb-3">
            Stock
          </h2>
          <StockSummary />
        </div>

      </div>
    </div>
  );
}

// ── Stock summary (fetches separately so it doesn't block the rest) ───────────

function StockSummary() {
  const [products, setProducts] = useState<{ active: number; total: number } | null>(null);

  useEffect(() => {
    fetch("/api/merchant/products?limit=500")
      .then((r) => r.json())
      .then((d) => {
        const all = d.products ?? [];
        setProducts({ total: all.length, active: all.filter((p: { active: boolean }) => p.active).length });
      })
      .catch(() => setProducts({ total: 0, active: 0 }));
  }, []);

  const total = products?.total ?? 0;
  const active = products?.active ?? 0;

  return (
    <div className="grid grid-cols-3 gap-3">
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50">
              <Package className="h-4 w-4 text-slate-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{products ? total : "—"}</p>
              <p className="text-xs text-gray-500">Total Products</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50">
              <ShoppingBag className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{products ? active : "—"}</p>
              <p className="text-xs text-gray-500">Active / Listed</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-100">
              <Package className="h-4 w-4 text-gray-400" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900">{products ? total - active : "—"}</p>
              <p className="text-xs text-gray-500">Unlisted</p>
            </div>
          </div>
        </CardContent>
      </Card>
      <div className="col-span-3 flex justify-end">
        <Link href="/products" className="text-xs font-medium text-[#238D9D] hover:underline">
          Manage products →
        </Link>
      </div>
    </div>
  );
}
