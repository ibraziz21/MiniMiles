"use client";

import { useEffect, useState, useCallback } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowsDownUp,
  CalendarBlank,
  CaretDown,
  CheckCircle,
  Gear,
  Spinner,
  Tag,
  Wallet,
  X,
} from "@phosphor-icons/react";

// ── Types ─────────────────────────────────────────────────────────────────────

type BillingSummary = {
  total_credits_cusd: number;
  total_credits_kes: number;
  total_debits_cusd: number;
  total_debits_kes: number;
  net_cusd: number;
  net_kes: number;
  order_count: number;
  avg_order_cusd: number;
  avg_order_kes: number;
};

type BillingTx = {
  id: string;
  date: string;
  type: "credit" | "debit";
  status: string;
  description: string;
  category: string | null;
  product_id: string | null;
  amount_cusd: number;
  amount_kes: number;
  voucher_code: string | null;
  discount_kes: number | null;
  payment_currency: string | null;
  payment_ref: string | null;
  customer: string | null;
};

type BillingResponse = {
  period: { year: number; month: number };
  currency: { usd_label: string; kes_rate: number };
  summary: BillingSummary;
  payout_wallet: string | null;
  transactions: BillingTx[];
};

type Settings = {
  payout_wallet: string | null;
  kes_exchange_rate: number | null;
  store_active: boolean | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function fmtKes(n: number) {
  return `KES ${n.toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;
}
function fmtUsd(n: number) {
  return `$${n.toFixed(2)}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-KE", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

// ── Top-level auth gate — merchant enters slug + secret ───────────────────────

function AuthGate({ onAuth }: { onAuth: (slug: string, secret: string) => void }) {
  const [slug,   setSlug]   = useState("");
  const [secret, setSecret] = useState("");
  const [err,    setErr]    = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!slug.trim() || !secret.trim()) { setErr("Both fields are required."); return; }
    onAuth(slug.trim(), secret.trim());
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7FEFF] p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-lg p-8">
        <h1 className="text-2xl font-bold text-[#0D7A8A] mb-1">Merchant Portal</h1>
        <p className="text-sm text-gray-500 mb-6">Sign in with your merchant slug and secret key.</p>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Merchant Slug</label>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="e.g. naivas"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#238D9D]"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 mb-1">Secret Key</label>
            <input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder="••••••••"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#238D9D]"
            />
          </div>
          {err && <p className="text-xs text-red-500">{err}</p>}
          <button
            type="submit"
            className="w-full bg-[#238D9D] text-white rounded-xl py-3 text-sm font-bold"
          >
            Sign In
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Settings panel ────────────────────────────────────────────────────────────

function SettingsPanel({
  slug,
  secret,
  onClose,
}: {
  slug: string;
  secret: string;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);
  const [saved,    setSaved]    = useState(false);
  const [wallet,   setWallet]   = useState("");
  const [rate,     setRate]     = useState("");
  const [err,      setErr]      = useState("");

  useEffect(() => {
    fetch(`/api/merchant/settings?slug=${slug}`, {
      headers: { "x-merchant-secret": secret },
    })
      .then((r) => r.json())
      .then((d) => {
        setSettings(d.settings ?? {});
        setWallet(d.settings?.payout_wallet ?? "");
        setRate(d.settings?.kes_exchange_rate ? String(d.settings.kes_exchange_rate) : "130");
      })
      .catch(() => setErr("Failed to load settings."))
      .finally(() => setLoading(false));
  }, [slug, secret]);

  async function save() {
    setSaving(true);
    setErr("");
    try {
      const body: Record<string, unknown> = {};
      if (wallet !== (settings?.payout_wallet ?? ""))
        body.payout_wallet = wallet || null;
      if (rate !== String(settings?.kes_exchange_rate ?? 130))
        body.kes_exchange_rate = Number(rate);

      if (Object.keys(body).length === 0) { setSaved(true); setSaving(false); return; }

      const res = await fetch(`/api/merchant/settings?slug=${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-merchant-secret": secret },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-3xl p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-bold text-lg">Settings</h2>
          <button onClick={onClose}><X size={20} className="text-gray-400" /></button>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Spinner size={28} className="animate-spin text-[#238D9D]" /></div>
        ) : (
          <div className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                Payout Wallet Address
              </label>
              <input
                value={wallet}
                onChange={(e) => setWallet(e.target.value)}
                placeholder="0x..."
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:border-[#238D9D]"
              />
              <p className="text-xs text-gray-400 mt-1">Wallet that receives payouts from AkibaMiles.</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">
                KES Exchange Rate (per 1 USD)
              </label>
              <input
                type="number"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                min={1}
                max={10000}
                className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#238D9D]"
              />
              <p className="text-xs text-gray-400 mt-1">Used to display KES equivalents. Default: 130.</p>
            </div>
            {err && <p className="text-xs text-red-500">{err}</p>}
            <button
              onClick={save}
              disabled={saving}
              className="w-full bg-[#238D9D] text-white rounded-xl py-3 text-sm font-bold disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {saved
                ? <><CheckCircle size={16} weight="fill" /> Saved</>
                : saving ? <><Spinner size={16} className="animate-spin" /> Saving…</> : "Save Settings"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function MerchantDashboard() {
  const now = new Date();
  const [slug,    setSlug]    = useState<string | null>(null);
  const [secret,  setSecret]  = useState<string | null>(null);
  const [tab,     setTab]     = useState<"billing" | "vouchers">("billing");
  const [year,    setYear]    = useState(now.getUTCFullYear());
  const [month,   setMonth]   = useState(now.getUTCMonth() + 1);
  const [data,    setData]    = useState<BillingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [authErr, setAuthErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [currencyMode, setCurrencyMode] = useState<"kes" | "usd">("kes");
  const [typeFilter, setTypeFilter] = useState<"all" | "credit" | "debit">("all");

  const fetchBilling = useCallback(
    async (s: string, sec: string, y: number, m: number) => {
      setLoading(true);
      setAuthErr("");
      try {
        const res = await fetch(
          `/api/merchant/billing?slug=${s}&year=${y}&month=${m}`,
          { headers: { "x-merchant-secret": sec } }
        );
        if (res.status === 401) { setAuthErr("Invalid credentials."); setSlug(null); return; }
        if (!res.ok) throw new Error("Failed to load billing data");
        setData(await res.json());
      } catch (e: any) {
        setAuthErr(e.message);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  function handleAuth(s: string, sec: string) {
    setSlug(s);
    setSecret(sec);
    fetchBilling(s, sec, year, month);
  }

  useEffect(() => {
    if (slug && secret) fetchBilling(slug, secret, year, month);
  }, [slug, secret, year, month, fetchBilling]);

  if (!slug || !secret) return <AuthGate onAuth={handleAuth} />;

  const summary = data?.summary;
  const txs = (data?.transactions ?? []).filter(
    (tx) => typeFilter === "all" || tx.type === typeFilter
  );
  const kesRate = data?.currency.kes_rate ?? 130;
  const monthLabel = `${MONTHS[(month - 1 + 12) % 12]} ${year}`;

  function prevMonth() {
    if (month === 1) { setYear((y) => y - 1); setMonth(12); }
    else setMonth((m) => m - 1);
  }
  function nextMonth() {
    const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
    if (isCurrentMonth) return;
    if (month === 12) { setYear((y) => y + 1); setMonth(1); }
    else setMonth((m) => m + 1);
  }

  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;

  return (
    <main className="min-h-screen bg-[#F4FBFC] pb-24">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-[#238D9D] font-semibold uppercase tracking-wider">Merchant Portal</p>
          <h1 className="text-lg font-bold capitalize">{slug}</h1>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="p-2 rounded-xl bg-gray-100 text-gray-500 hover:bg-gray-200"
        >
          <Gear size={20} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-5 pt-4 pb-2">
        {(["billing", "vouchers"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
              tab === t
                ? "bg-[#238D9D] text-white"
                : "bg-white text-gray-500 border border-gray-200"
            }`}
          >
            {t === "billing" ? "Billing" : "Vouchers"}
          </button>
        ))}
      </div>

      {tab === "billing" && (
        <>
          {/* Month navigator */}
          <div className="flex items-center justify-between px-5 py-3">
            <button onClick={prevMonth} className="text-[#238D9D] font-bold text-xl px-2">‹</button>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-700">
              <CalendarBlank size={16} className="text-[#238D9D]" />
              {monthLabel}
              {isCurrentMonth && (
                <span className="bg-[#238D9D1A] text-[#238D9D] text-xs rounded-full px-2 py-0.5 font-medium">
                  Month to date
                </span>
              )}
            </div>
            <button
              onClick={nextMonth}
              disabled={isCurrentMonth}
              className={`font-bold text-xl px-2 ${isCurrentMonth ? "text-gray-300" : "text-[#238D9D]"}`}
            >
              ›
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-16">
              <Spinner size={32} className="animate-spin text-[#238D9D]" />
            </div>
          ) : authErr ? (
            <p className="text-center text-red-500 py-10 text-sm">{authErr}</p>
          ) : summary ? (
            <>
              {/* Currency toggle */}
              <div className="px-5 mb-3 flex justify-end">
                <button
                  onClick={() => setCurrencyMode((c) => c === "kes" ? "usd" : "kes")}
                  className="flex items-center gap-1.5 text-xs font-semibold text-[#238D9D] bg-[#238D9D1A] rounded-full px-3 py-1.5"
                >
                  <ArrowsDownUp size={12} />
                  {currencyMode === "kes" ? "Show USD" : "Show KES"}
                </button>
              </div>

              {/* Summary cards */}
              <div className="px-5 grid grid-cols-2 gap-3 mb-4">
                <SummaryCard
                  label="Credits"
                  icon={<ArrowDown size={16} weight="bold" className="text-green-600" />}
                  value={currencyMode === "kes" ? fmtKes(summary.total_credits_kes) : fmtUsd(summary.total_credits_cusd)}
                  sub={currencyMode === "kes" ? fmtUsd(summary.total_credits_cusd) : fmtKes(summary.total_credits_kes)}
                  color="green"
                />
                <SummaryCard
                  label="Debits"
                  icon={<ArrowUp size={16} weight="bold" className="text-red-500" />}
                  value={currencyMode === "kes" ? fmtKes(summary.total_debits_kes) : fmtUsd(summary.total_debits_cusd)}
                  sub={currencyMode === "kes" ? fmtUsd(summary.total_debits_cusd) : fmtKes(summary.total_debits_kes)}
                  color="red"
                />
                <SummaryCard
                  label="Net"
                  icon={<Wallet size={16} weight="bold" className="text-[#238D9D]" />}
                  value={currencyMode === "kes" ? fmtKes(summary.net_kes) : fmtUsd(summary.net_cusd)}
                  sub={currencyMode === "kes" ? fmtUsd(summary.net_cusd) : fmtKes(summary.net_kes)}
                  color="teal"
                />
                <SummaryCard
                  label="Orders"
                  icon={<Tag size={16} weight="bold" className="text-purple-500" />}
                  value={String(summary.order_count)}
                  sub={`avg ${currencyMode === "kes" ? fmtKes(summary.avg_order_kes) : fmtUsd(summary.avg_order_cusd)}`}
                  color="purple"
                />
              </div>

              {/* Payout wallet */}
              {data?.payout_wallet && (
                <div className="mx-5 mb-4 bg-white border border-gray-100 rounded-2xl px-4 py-3 flex items-center gap-3">
                  <Wallet size={18} className="text-[#238D9D] shrink-0" />
                  <div className="overflow-hidden">
                    <p className="text-xs text-gray-400 font-medium">Payout wallet</p>
                    <p className="text-xs font-mono text-gray-700 truncate">{data.payout_wallet}</p>
                  </div>
                </div>
              )}

              {/* KES rate note */}
              <p className="px-5 text-xs text-gray-400 mb-3">
                Exchange rate: 1 USD = {kesRate} KES
              </p>

              {/* Transaction filter */}
              <div className="px-5 flex gap-2 mb-3">
                {(["all", "credit", "debit"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setTypeFilter(f)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
                      typeFilter === f
                        ? "bg-[#238D9D] text-white"
                        : "bg-white text-gray-500 border border-gray-200"
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>

              {/* Transaction list */}
              <div className="px-5 space-y-2">
                {txs.length === 0 ? (
                  <p className="text-center text-gray-400 py-10 text-sm">No transactions for this period.</p>
                ) : (
                  txs.map((tx) => (
                    <TxRow key={tx.id} tx={tx} currencyMode={currencyMode} />
                  ))
                )}
              </div>
            </>
          ) : null}
        </>
      )}

      {tab === "vouchers" && (
        <div className="px-5 py-6 text-center text-gray-400 text-sm">
          Voucher template management coming soon.
        </div>
      )}

      {showSettings && slug && secret && (
        <SettingsPanel slug={slug} secret={secret} onClose={() => setShowSettings(false)} />
      )}
    </main>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SummaryCard({
  label, icon, value, sub, color,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  sub: string;
  color: "green" | "red" | "teal" | "purple";
}) {
  const bg: Record<typeof color, string> = {
    green:  "bg-green-50  border-green-100",
    red:    "bg-red-50    border-red-100",
    teal:   "bg-[#238D9D1A] border-[#238D9D33]",
    purple: "bg-purple-50 border-purple-100",
  };
  return (
    <div className={`rounded-2xl border p-4 ${bg[color]}`}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
      </div>
      <p className="font-bold text-base leading-tight">{value}</p>
      <p className="text-xs text-gray-400 mt-0.5">{sub}</p>
    </div>
  );
}

function TxRow({
  tx,
  currencyMode,
}: {
  tx: BillingTx;
  currencyMode: "kes" | "usd";
}) {
  const [expanded, setExpanded] = useState(false);
  const isCredit = tx.type === "credit";

  return (
    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
            isCredit ? "bg-green-100" : "bg-red-100"
          }`}
        >
          {isCredit
            ? <ArrowDown size={14} weight="bold" className="text-green-600" />
            : <ArrowUp size={14} weight="bold" className="text-red-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{tx.description}</p>
          <p className="text-xs text-gray-400">{fmtDate(tx.date)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className={`text-sm font-bold ${isCredit ? "text-green-600" : "text-red-500"}`}>
            {isCredit ? "+" : "−"}
            {currencyMode === "kes" ? fmtKes(tx.amount_kes) : fmtUsd(tx.amount_cusd)}
          </p>
          <p className="text-xs text-gray-400">
            {currencyMode === "kes" ? fmtUsd(tx.amount_cusd) : fmtKes(tx.amount_kes)}
          </p>
        </div>
        <CaretDown
          size={14}
          className={`text-gray-300 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-1.5 bg-gray-50">
          <DetailRow label="Status" value={tx.status} />
          {tx.customer && <DetailRow label="Customer" value={tx.customer} />}
          {tx.category && <DetailRow label="Category" value={tx.category} />}
          {tx.product_id && <DetailRow label="Product ID" value={tx.product_id} />}
          {tx.voucher_code && <DetailRow label="Voucher" value={tx.voucher_code} />}
          {tx.discount_kes != null && (
            <DetailRow label="Discount" value={`KES ${tx.discount_kes.toLocaleString()}`} />
          )}
          {tx.payment_currency && <DetailRow label="Currency paid" value={tx.payment_currency} />}
          {tx.payment_ref && (
            <DetailRow
              label="Tx ref"
              value={`${tx.payment_ref.slice(0, 10)}…${tx.payment_ref.slice(-6)}`}
            />
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="font-medium text-gray-700 text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}
