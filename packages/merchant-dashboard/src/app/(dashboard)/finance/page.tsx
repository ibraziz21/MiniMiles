"use client";

import { useState, useEffect, FormEvent } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Clock,
  Tag,
  CheckCircle,
  Copy,
  Check,
  Wallet,
} from "lucide-react";
import type { FinanceStats } from "@/types";

function fmtUSD(val: number) {
  return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtKES(val: number) {
  return `KES ${Math.round(val * 130).toLocaleString("en-KE")}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleString("default", {
    month: "short",
    year: "2-digit",
  });
}

function MoMBadge({ current, previous }: { current: number; previous: number }) {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const up = pct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
        up ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
      }`}
    >
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}
      {pct}% vs last month
    </span>
  );
}

export default function FinancePage() {
  const [data, setData] = useState<FinanceStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwner, setIsOwner] = useState(false);

  // Wallet editing state
  const [editingWallet, setEditingWallet] = useState(false);
  const [walletInput, setWalletInput] = useState("");
  const [walletSaving, setWalletSaving] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [walletSaved, setWalletSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch("/api/merchant/finance").then((r) => r.json()),
      fetch("/api/auth/session").then((r) => r.json()),
    ]).then(([finData, sessionData]) => {
      setData(finData as FinanceStats);
      setWalletInput((finData as FinanceStats).wallet_address ?? "");
      if (sessionData?.merchant?.role === "owner") setIsOwner(true);
    }).finally(() => setLoading(false));
  }, []);

  async function saveWallet(e: FormEvent) {
    e.preventDefault();
    setWalletError(null);
    setWalletSaving(true);
    try {
      const res = await fetch("/api/merchant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet_address: walletInput.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok) { setWalletError(d.error ?? "Failed to save"); return; }
      setData((prev) => prev ? { ...prev, wallet_address: d.settings.wallet_address } : prev);
      setWalletSaved(true);
      setEditingWallet(false);
      setTimeout(() => setWalletSaved(false), 3000);
    } catch {
      setWalletError("Network error");
    } finally {
      setWalletSaving(false);
    }
  }

  function copyAddress() {
    if (!data?.wallet_address) return;
    navigator.clipboard.writeText(data.wallet_address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title="Finance" subtitle="Revenue, payouts & payment details" />
        <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Loading…</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar title="Finance" subtitle="Revenue, payouts & payment details" />
        <div className="flex-1 flex items-center justify-center text-sm text-red-500">Failed to load finance data.</div>
      </div>
    );
  }

  const maxMonthRevenue = data.monthly.reduce((m, r) => Math.max(m, r.revenue_cusd), 1);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Finance" subtitle="Revenue, payouts & payment details" />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── Top KPI cards ── */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                  <DollarSign className="h-5 w-5 text-emerald-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold text-gray-900">{fmtUSD(data.total_revenue_cusd)}</p>
                  <p className="text-xs text-gray-500">Total Revenue</p>
                  <p className="text-xs text-gray-400 mt-0.5">{fmtKES(data.total_revenue_cusd)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#238D9D]/10">
                  <TrendingUp className="h-5 w-5 text-[#238D9D]" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold text-gray-900">{fmtUSD(data.this_month_revenue_cusd)}</p>
                  <p className="text-xs text-gray-500">This Month</p>
                  <div className="mt-1">
                    <MoMBadge
                      current={data.this_month_revenue_cusd}
                      previous={data.last_month_revenue_cusd}
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-50">
                  <Clock className="h-5 w-5 text-amber-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold text-gray-900">{fmtUSD(data.estimated_receivable_cusd)}</p>
                  <p className="text-xs text-gray-500">Estimated to Receive</p>
                  <p className="text-xs text-gray-400 mt-0.5">Orders in transit</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50">
                  <Tag className="h-5 w-5 text-purple-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-2xl font-bold text-gray-900">{data.issued_vouchers_outstanding}</p>
                  <p className="text-xs text-gray-500">Vouchers Outstanding</p>
                  <p className="text-xs text-gray-400 mt-0.5">{data.active_voucher_templates} active template{data.active_voucher_templates !== 1 ? "s" : ""}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Second row ── */}
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Monthly revenue chart */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Monthly Revenue (last 6 months)</CardTitle>
            </CardHeader>
            <CardContent>
              {data.monthly.length === 0 ? (
                <p className="text-sm text-gray-500">No completed orders yet.</p>
              ) : (
                <div className="space-y-1">
                  {data.monthly.map((m) => {
                    const pct = Math.round((m.revenue_cusd / maxMonthRevenue) * 100);
                    return (
                      <div key={m.month} className="flex items-center gap-3">
                        <span className="w-14 shrink-0 text-xs text-gray-500">{monthLabel(m.month)}</span>
                        <div className="flex-1 overflow-hidden rounded-full bg-gray-100 h-3">
                          <div
                            className="h-3 rounded-full bg-[#238D9D] transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="w-24 text-right text-sm font-medium text-gray-700">
                          {fmtUSD(m.revenue_cusd)}
                        </span>
                        <span className="w-16 text-right text-xs text-gray-400">
                          {m.order_count} order{m.order_count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Summary stats */}
          <Card>
            <CardHeader>
              <CardTitle>Order Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
                <CheckCircle className="h-5 w-5 text-emerald-500 shrink-0" />
                <div>
                  <p className="text-lg font-bold text-gray-900">{data.total_completed_orders}</p>
                  <p className="text-xs text-gray-500">Total Completed Orders</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
                <TrendingUp className="h-5 w-5 text-[#238D9D] shrink-0" />
                <div>
                  <p className="text-lg font-bold text-gray-900">{data.this_month_completed_orders}</p>
                  <p className="text-xs text-gray-500">Completed This Month</p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
                <DollarSign className="h-5 w-5 text-gray-400 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-gray-700">
                    {data.total_completed_orders > 0
                      ? fmtUSD(data.total_revenue_cusd / data.total_completed_orders)
                      : "$0.00"}
                  </p>
                  <p className="text-xs text-gray-500">Avg. Order Value</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Payment details ── */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-[#238D9D]" />
                Payment Details
              </CardTitle>
              {!isOwner && (
                <span className="text-xs text-gray-400">Only owners can edit</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-500">
              Your Celo wallet address for receiving payments. Customers pay to this address when placing orders.
            </p>

            {/* Wallet address display / edit */}
            {editingWallet ? (
              <form onSubmit={saveWallet} className="flex items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <Input
                    value={walletInput}
                    onChange={(e) => setWalletInput(e.target.value)}
                    placeholder="0x..."
                    className="font-mono text-sm"
                  />
                  {walletError && (
                    <p className="mt-1 text-xs text-red-600">{walletError}</p>
                  )}
                </div>
                <Button type="submit" disabled={walletSaving} className="shrink-0">
                  {walletSaving ? "Saving…" : "Save"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingWallet(false);
                    setWalletInput(data.wallet_address ?? "");
                    setWalletError(null);
                  }}
                  className="shrink-0"
                >
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
                {data.wallet_address ? (
                  <>
                    <code className="flex-1 min-w-0 truncate text-sm font-mono text-gray-800">
                      {data.wallet_address}
                    </code>
                    <button
                      onClick={copyAddress}
                      className="shrink-0 text-gray-400 hover:text-gray-700 transition-colors"
                      title="Copy address"
                    >
                      {copied ? (
                        <Check className="h-4 w-4 text-green-500" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                    {isOwner && (
                      <button
                        onClick={() => setEditingWallet(true)}
                        className="shrink-0 text-xs font-medium text-[#238D9D] hover:underline"
                      >
                        Edit
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm text-gray-400 italic">No wallet address set</span>
                    {isOwner && (
                      <button
                        onClick={() => setEditingWallet(true)}
                        className="shrink-0 text-xs font-medium text-[#238D9D] hover:underline"
                      >
                        Add address
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {walletSaved && (
              <p className="text-xs text-green-600 flex items-center gap-1">
                <Check className="h-3 w-3" /> Wallet address saved.
              </p>
            )}

            {/* Invoice generation hint */}
            <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-4 py-3">
              <p className="text-xs font-medium text-gray-700 mb-1">Invoice Generation</p>
              <p className="text-xs text-gray-500">
                To generate an invoice for a specific order, open the order detail page and use the{" "}
                <span className="font-medium text-gray-700">Print / Export</span> option. Each order includes
                payment reference, amount, customer, and delivery details.
              </p>
            </div>

            {/* Network info */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: "Network", value: "Celo Mainnet" },
                { label: "Accepted Tokens", value: "cUSD · USDT" },
                { label: "Rate", value: "1 cUSD = KES 130" },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-sm font-medium text-gray-800">{value}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
