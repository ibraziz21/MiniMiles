"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  formatAge,
  minutesSince,
  isStaleReview,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  REJECTION_CODE_LABELS,
  RISK_FLAG_LABELS,
  slaState,
  STALE_REVIEW_MINUTES,
  type QueueRow,
} from "@/lib/subscriptionPayments";
import { formatDateTime } from "@/lib/utils";

type Filters = {
  status: string;
  method: string;
  invoiceType: string;
  merchant: string;
  reviewer: string;
  providerReference: string;
  submittedFrom: string;
  submittedTo: string;
  amountMin: string;
  amountMax: string;
};

type Props = {
  rows: QueueRow[];
  view: "queue" | "history";
  canDecide: boolean;
  initialFilters: Filters;
};

const SLA_BADGE: Record<string, string> = {
  neutral: "bg-slate-100 text-slate-600",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
};

export function SubscriptionPaymentQueue({ rows, view, canDecide, initialFilters }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [pending, startTransition] = useTransition();
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof Filters>(key: K, value: string) {
    setFilters((f) => ({ ...f, [key]: value }));
  }

  function apply() {
    const params = new URLSearchParams();
    if (view === "history") params.set("view", "history");
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    startTransition(() => router.push(`/finance/subscriptions?${params.toString()}`));
  }

  function reset() {
    setFilters({
      status: "",
      method: "",
      invoiceType: "",
      merchant: "",
      reviewer: "",
      providerReference: "",
      submittedFrom: "",
      submittedTo: "",
      amountMin: "",
      amountMax: "",
    });
    startTransition(() =>
      router.push(view === "history" ? "/finance/subscriptions?view=history" : "/finance/subscriptions"),
    );
  }

  async function startReview(row: QueueRow) {
    setClaiming(row.payment_attempt_id);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/subscription-payments/${row.payment_attempt_id}/start-review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedVersion: row.version }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not claim this attempt");
        router.refresh();
        return;
      }
      router.push(`/finance/subscriptions/${row.payment_attempt_id}`);
    } catch {
      setError("Network error");
    } finally {
      setClaiming(null);
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-4">
          <select
            value={filters.status}
            onChange={(e) => set("status", e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">Any status</option>
            {(view === "history"
              ? ["confirmed", "rejected"]
              : ["submitted", "under_review"]
            ).map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filters.method}
            onChange={(e) => set("method", e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          >
            <option value="">Any method</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          <Input
            placeholder="Invoice type"
            value={filters.invoiceType}
            onChange={(e) => set("invoiceType", e.target.value)}
          />
          <Input
            placeholder="Merchant / partner ID"
            value={filters.merchant}
            onChange={(e) => set("merchant", e.target.value)}
          />
          <Input
            placeholder="Reviewer admin ID"
            value={filters.reviewer}
            onChange={(e) => set("reviewer", e.target.value)}
          />
          <Input
            placeholder="Payer / provider reference"
            value={filters.providerReference}
            onChange={(e) => set("providerReference", e.target.value)}
          />
          <Input
            type="date"
            value={filters.submittedFrom}
            onChange={(e) => set("submittedFrom", e.target.value)}
          />
          <Input
            type="date"
            value={filters.submittedTo}
            onChange={(e) => set("submittedTo", e.target.value)}
          />
          <Input
            placeholder="Min amount (KES)"
            value={filters.amountMin}
            onChange={(e) => set("amountMin", e.target.value)}
          />
          <Input
            placeholder="Max amount (KES)"
            value={filters.amountMax}
            onChange={(e) => set("amountMax", e.target.value)}
          />
        </div>
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={apply} disabled={pending}>
            Apply filters
          </Button>
          <Button size="sm" variant="outline" onClick={reset} disabled={pending}>
            Reset
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full min-w-[1100px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Age / SLA</th>
              <th className="px-3 py-2">Merchant</th>
              <th className="px-3 py-2">Invoice / ref</th>
              <th className="px-3 py-2">Plan / term</th>
              <th className="px-3 py-2 text-right">Expected</th>
              <th className="px-3 py-2 text-right">Submitted</th>
              <th className="px-3 py-2">Method / payer ref</th>
              <th className="px-3 py-2">Payment date</th>
              <th className="px-3 py-2">Reviewer</th>
              <th className="px-3 py-2">Risk flags</th>
              <th className="px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-8 text-center text-slate-400">
                  Nothing in this {view === "history" ? "history" : "queue"}.
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const ageMin = minutesSince(row.submitted_at);
              const sla = slaState(row.submitted_at);
              const stale =
                row.status === "under_review" && isStaleReview(row.review_started_at);
              const flags = row.risk_flags ?? [];
              return (
                <tr key={row.payment_attempt_id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-xs font-medium ${SLA_BADGE[sla]}`}
                    >
                      {view === "history" ? formatDateTime(row.decided_at) : formatAge(ageMin)}
                    </span>
                    {stale && (
                      <span className="mt-1 block text-xs text-amber-600">
                        stale review &gt; {STALE_REVIEW_MINUTES}m
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Link
                      href={`/finance/subscriptions/${row.payment_attempt_id}`}
                      className="font-medium text-[#176B78] hover:underline"
                    >
                      {row.merchant_name ?? row.partner_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <div>{row.invoice_number ?? row.invoice_id.slice(0, 8)}</div>
                    <div className="text-xs text-slate-400">
                      {row.invoice_type} · {row.short_payment_reference ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {row.plan ?? "—"}
                    <div className="text-xs text-slate-400">{row.billing_term ?? "—"}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.expected_amount ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {row.submitted_amount ?? "—"}
                    <div className="text-xs text-slate-400">{row.submitted_currency ?? ""}</div>
                  </td>
                  <td className="px-3 py-2">
                    {row.payment_method ?? "—"}
                    <div className="font-mono text-xs text-slate-400">
                      {row.provider_reference_masked ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs">{formatDateTime(row.payment_date)}</td>
                  <td className="px-3 py-2 text-xs">
                    {row.reviewer_name ?? (row.reviewer_admin_user_id ? "claimed" : "—")}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {flags.length === 0 && <span className="text-xs text-slate-300">none</span>}
                      {flags.map((flag) => (
                        <Badge key={flag} variant="warning" className="text-[10px]">
                          {RISK_FLAG_LABELS[flag] ?? flag}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {view === "history" ? (
                      <div className="text-xs text-slate-500">
                        {row.status === "rejected"
                          ? REJECTION_CODE_LABELS[
                              row.decision_reason as keyof typeof REJECTION_CODE_LABELS
                            ] ?? row.decision_reason
                          : row.receipt_number}
                      </div>
                    ) : row.status === "submitted" && canDecide ? (
                      <Button
                        size="sm"
                        onClick={() => startReview(row)}
                        disabled={claiming === row.payment_attempt_id}
                      >
                        {claiming === row.payment_attempt_id ? "Claiming…" : "Start review"}
                      </Button>
                    ) : (
                      <Link
                        href={`/finance/subscriptions/${row.payment_attempt_id}`}
                        className="text-xs font-medium text-[#176B78] hover:underline"
                      >
                        Open
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
