"use client";

import { useEffect, useState, FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Banknote, Plus, CheckCircle2, Clock, ShieldCheck, Download } from "lucide-react";

interface Destination {
  id: string;
  destination_type: string;
  display_name: string;
  currency: string;
  destination_summary: string;
  is_active: boolean;
  verified_at: string | null;
  approved_at: string | null;
  last_modified_at: string | null;
  created_at: string;
}

const COOLING_HOURS = 24;
const COMING_SOON_TYPES = new Set(["mpesa", "celo_wallet"]);

const TYPE_FIELDS: Record<string, { key: string; label: string }[]> = {
  mpesa: [{ key: "phone", label: "Phone number" }],
  bank: [
    { key: "bank_name", label: "Bank name" },
    { key: "account_number", label: "Account number" },
  ],
  celo_wallet: [{ key: "address", label: "Wallet address" }],
  manual: [{ key: "description", label: "Description" }],
};

function coolingStatus(dest: Destination): { inCooling: boolean; hoursLeft: number } {
  if (!dest.approved_at || !dest.last_modified_at) return { inCooling: false, hoursLeft: 0 };
  const modifiedMs = new Date(dest.last_modified_at).getTime();
  const expiresMs = modifiedMs + COOLING_HOURS * 60 * 60 * 1000;
  const diffMs = expiresMs - Date.now();
  if (diffMs <= 0) return { inCooling: false, hoursLeft: 0 };
  return { inCooling: true, hoursLeft: Math.ceil(diffMs / (60 * 60 * 1000)) };
}

export function PayoutDestinations({ isOwner }: { isOwner: boolean }) {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState("bank");
  const [displayName, setDisplayName] = useState("");
  const [currency, setCurrency] = useState("KES");
  const [fields, setFields] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/finance/payout-destinations");
      const d = await res.json();
      setDestinations((d.destinations ?? []) as Destination[]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/finance/payout-destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination_type: type,
          display_name: displayName.trim(),
          currency,
          destination_details: fields,
        }),
      });
      const d = await res.json();
      if (!res.ok) {
        setError(d.error ?? "Failed to add destination");
        return;
      }
      setShowForm(false);
      setDisplayName("");
      setFields({});
      await load();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  const active = destinations.filter((d) => d.is_active && d.approved_at);
  const pending = destinations.filter((d) => !d.approved_at);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5 text-[#238D9D]" />
            Payout Destinations
          </CardTitle>
          {isOwner && !showForm && (
            <Button variant="outline" onClick={() => setShowForm(true)} className="gap-2">
              <Plus className="h-4 w-4" /> Add destination
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-gray-500">
          Where AkibaMiles sends your voucher reimbursements. New destinations require admin
          verification, approval, and a 24-hour cooling period before they can be used.
        </p>

        {/* Coming soon notice for automated providers */}
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-500">
          <strong>M-Pesa B2C</strong> and <strong>Celo wallet</strong> payouts are coming soon.
          Currently available: Bank transfer and Manual payment.
        </div>

        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            {/* Active destinations */}
            {active.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Active</p>
                {active.map((d) => {
                  const { inCooling, hoursLeft } = coolingStatus(d);
                  const comingSoon = COMING_SOON_TYPES.has(d.destination_type);
                  return (
                    <div
                      key={d.id}
                      className="flex items-start justify-between rounded-lg border border-green-200 bg-green-50 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{d.display_name}</p>
                        <p className="text-xs text-gray-500">
                          {d.destination_summary} · {d.currency} ·{" "}
                          {d.destination_type.replace(/_/g, " ")}
                          {comingSoon && (
                            <span className="ml-2 rounded-full bg-amber-100 px-1.5 py-0.5 text-amber-700">
                              Coming soon
                            </span>
                          )}
                        </p>
                        {inCooling && (
                          <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
                            <Clock className="h-3 w-3" />
                            Cooling period: {hoursLeft}h remaining before active use
                          </p>
                        )}
                      </div>
                      <span className="ml-4 inline-flex shrink-0 items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                        <CheckCircle2 className="h-3 w-3" /> Active
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Pending approval */}
            {pending.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  Pending admin approval
                </p>
                {pending.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-start justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{d.display_name}</p>
                      <p className="text-xs text-gray-500">
                        {d.destination_summary} · {d.currency} ·{" "}
                        {d.destination_type.replace(/_/g, " ")}
                      </p>
                    </div>
                    <div className="ml-4 flex shrink-0 flex-col items-end gap-1">
                      {d.verified_at ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                          <ShieldCheck className="h-3 w-3" /> Verified
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                          <Clock className="h-3 w-3" /> Awaiting verification
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <Clock className="h-3 w-3" /> Pending approval
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {destinations.length === 0 && (
              <p className="text-sm text-gray-400 italic">No payout destinations yet.</p>
            )}
          </>
        )}

        {/* Add destination form */}
        {showForm && (
          <form
            onSubmit={submit}
            className="space-y-3 rounded-lg border border-dashed border-gray-300 p-4"
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <select
                value={type}
                onChange={(e) => { setType(e.target.value); setFields({}); }}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="bank">Bank transfer</option>
                <option value="manual">Manual</option>
                <option value="mpesa" disabled>M-Pesa (coming soon)</option>
                <option value="celo_wallet" disabled>Celo wallet (coming soon)</option>
              </select>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Display name"
              />
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="KES">KES</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {(TYPE_FIELDS[type] ?? []).map((f) => (
                <Input
                  key={f.key}
                  value={fields[f.key] ?? ""}
                  onChange={(e) => setFields((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.label}
                />
              ))}
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : "Submit for approval"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => { setShowForm(false); setError(null); }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

/** Compact receipt download link used in the payout history section. */
export function ReceiptLink({ instructionId, receiptNumber }: { instructionId: string; receiptNumber: string }) {
  return (
    <a
      href={`/api/finance/payout-receipts/${instructionId}`}
      download={`receipt-${receiptNumber}.json`}
      className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
    >
      <Download className="h-3 w-3" /> Receipt
    </a>
  );
}
