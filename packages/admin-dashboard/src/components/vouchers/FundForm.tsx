"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface FundFormInitial {
  id: string;
  version: number;
  name: string;
  sponsorshipLabel: string;
  countryCode: string;
  authorizedBudgetKes: number;
  startsAt: string;
  endsAt: string;
  costCenterReference: string;
  notes: string;
}

// Fund creation/edit form — companion admin spec §7.1. Country and currency
// are fixed at KE/KES for the MVP per the spec's founding-partner example;
// only the fields the spec actually asks for at this step are shown here.
export function FundForm({ initial }: { initial?: FundFormInitial }) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [sponsorshipLabel, setSponsorshipLabel] = useState(initial?.sponsorshipLabel ?? "Funded by Akiba");
  const [countryCode, setCountryCode] = useState(initial?.countryCode ?? "KE");
  const [authorizedBudgetKes, setAuthorizedBudgetKes] = useState(
    initial ? String(initial.authorizedBudgetKes) : "",
  );
  const [startsAt, setStartsAt] = useState(initial?.startsAt.slice(0, 16) ?? "");
  const [endsAt, setEndsAt] = useState(initial?.endsAt.slice(0, 16) ?? "");
  const [costCenterReference, setCostCenterReference] = useState(initial?.costCenterReference ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const body: Record<string, unknown> = {
      name,
      sponsorshipLabel,
      countryCode,
      authorizedBudgetKes: Number(authorizedBudgetKes),
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      costCenterReference,
      notes,
    };
    if (isEdit) body.expectedVersion = initial!.version;

    const res = await fetch(isEdit ? `/api/admin/voucher-funds/${initial!.id}` : "/api/admin/voucher-funds", {
      method: isEdit ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(result.error ?? "Failed to save fund.");
      return;
    }
    router.push(`/vouchers/funds/${result.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6 p-6">
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <Card>
        <CardHeader>
          <CardTitle>Fund details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Internal name">
            <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Founding Partners Launch — Kenya" />
          </Field>
          <Field label="Customer-facing sponsorship label">
            <Input value={sponsorshipLabel} onChange={(e) => setSponsorshipLabel(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Country (ISO alpha-2)">
              <Input
                required
                maxLength={2}
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Authorized budget (KES)">
              <Input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={authorizedBudgetKes}
                onChange={(e) => setAuthorizedBudgetKes(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Starts (Africa/Nairobi)">
              <Input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            </Field>
            <Field label="Ends (Africa/Nairobi)">
              <Input required type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Cost center / authorization reference">
            <Input value={costCenterReference} onChange={(e) => setCostCenterReference(e.target.value)} />
          </Field>
          <Field label="Internal notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="flex w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
            />
          </Field>
        </CardContent>
      </Card>
      <Button type="submit" disabled={busy}>
        {isEdit ? "Save changes" : "Create draft fund"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}
