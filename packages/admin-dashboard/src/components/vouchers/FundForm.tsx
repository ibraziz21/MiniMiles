"use client";

import {
  toNairobiDateTimeInput,
  fromNairobiDateTimeInput,
} from "@/lib/voucherFundDates";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { PiggyBank, ShieldCheck, PlusCircle } from "lucide-react";
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
  campaignTitle?: string;
}

// Fund creation/edit form — companion admin spec §7.1. Country and currency
// are fixed at KE/KES for the MVP per the spec's founding-partner example;
// only the fields the spec actually asks for at this step are shown here.
export function FundForm({ initial }: { initial?: FundFormInitial }) {
  const router = useRouter();
  const requestLock = useRef(false);
  const isEdit = Boolean(initial);
  const [name, setName] = useState(initial?.name ?? "");
  const [sponsorshipLabel, setSponsorshipLabel] = useState(
    initial?.sponsorshipLabel ?? "Funded by Akiba"
  );
  const [countryCode, setCountryCode] = useState(initial?.countryCode ?? "KE");
  const [authorizedBudgetKes, setAuthorizedBudgetKes] = useState(
    initial ? String(initial.authorizedBudgetKes) : ""
  );
  const [startsAt, setStartsAt] = useState(
    initial ? toNairobiDateTimeInput(initial.startsAt) : ""
  );
  const [endsAt, setEndsAt] = useState(
    initial ? toNairobiDateTimeInput(initial.endsAt) : ""
  );
  const [costCenterReference, setCostCenterReference] = useState(
    initial?.costCenterReference ?? ""
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [campaignTitle, setCampaignTitle] = useState(
    initial?.campaignTitle ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorSummary = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) {
      errorSummary.current?.focus();
      errorSummary.current?.scrollIntoView({ block: "center" });
    }
  }, [error]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        name,
        sponsorshipLabel,
        countryCode,
        authorizedBudgetKes: Number(authorizedBudgetKes),
        startsAt: fromNairobiDateTimeInput(startsAt),
        endsAt: fromNairobiDateTimeInput(endsAt),
        costCenterReference,
        notes,
        campaignTitle,
      };
      if (isEdit) body.expectedVersion = initial!.version;

      const res = await fetch(
        isEdit
          ? `/api/admin/voucher-funds/${initial!.id}`
          : "/api/admin/voucher-funds",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      const result = await res.json();
      setBusy(false);
      if (!res.ok) {
        setError(result.error ?? "Failed to save fund.");
        return;
      }
      router.push(`/vouchers/funds/${result.data.id}`);
      router.refresh();
    } catch {
      setError("Couldn’t save the fund. Check your connection and try again.");
    } finally {
      requestLock.current = false;
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      onInvalidCapture={(event) => {
        let details = (event.target as HTMLElement).closest("details");
        while (details) {
          details.open = true;
          details = details.parentElement?.closest("details") ?? null;
        }
      }}
      className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6 [&_input]:h-12 [&_input]:min-w-0 [&_input]:rounded-control [&_input]:border-0 [&_input]:bg-white [&_input]:text-base [&_input]:shadow-sm"
    >
      <div className="flex items-start gap-3 rounded-card bg-gradient-to-br from-[#EAEDFF] to-[#D9F9FC] p-5">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <PiggyBank className="h-6 w-6 text-primary" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-xl font-semibold">
            {isEdit ? "Edit reward fund" : "New reward fund"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Set a budget and schedule for merchant voucher allocations.
          </p>
        </div>
      </div>
      {error && (
        <p
          ref={errorSummary}
          tabIndex={-1}
          role="alert"
          className="rounded-control bg-red-50 p-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <fieldset disabled={busy} className="space-y-5">
        <Field label="Fund title">
          <Input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Nairobi Breakfast Subsidy"
          />
        </Field>
        <Field label="Total budget (KES)">
          <Input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={authorizedBudgetKes}
            onChange={(e) => setAuthorizedBudgetKes(e.target.value)}
            placeholder="1,200,000"
          />
          <span className="block text-xs text-ink-muted">
            Authorized pool for merchant vouchers.
          </span>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Start date & time (EAT)">
            <Input
              required
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </Field>
          <Field label="End date & time (EAT)">
            <Input
              required
              type="datetime-local"
              min={startsAt || undefined}
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
          </Field>
        </div>
        <Field label="Description / notes (internal, optional)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-control border-0 bg-white p-4 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-primary"
            placeholder="Describe this fund’s purpose…"
          />
        </Field>
        <details className="rounded-card bg-white p-4 shadow-sm">
          <summary className="min-h-11 cursor-pointer font-medium focus-visible:outline-primary">
            More options
          </summary>
          <div className="mt-3 space-y-4 [&_input]:bg-[#F2F3FF]">
            <Field label="Public campaign name (optional)">
              <Input
                maxLength={120}
                value={campaignTitle}
                onChange={(e) => setCampaignTitle(e.target.value)}
              />
            </Field>
            <Field label="Sponsorship label">
              <Input
                value={sponsorshipLabel}
                onChange={(e) => setSponsorshipLabel(e.target.value)}
              />
            </Field>
            <Field label="Country (ISO alpha-2)">
              <Input
                required
                maxLength={2}
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value.toUpperCase())}
              />
            </Field>
            <Field label="Cost center / authorization reference">
              <Input
                value={costCenterReference}
                onChange={(e) => setCostCenterReference(e.target.value)}
              />
            </Field>
          </div>
        </details>
      </fieldset>
      <div className="flex items-start gap-3 rounded-control bg-[#F2F3FF] p-4">
        <ShieldCheck
          className="h-5 w-5 shrink-0 text-primary"
          aria-hidden="true"
        />
        <p className="text-sm text-ink-muted">
          {isEdit
            ? "Changes apply to this draft fund."
            : "Saved as a draft. Submit and publish the fund before adding merchant allocations."}
        </p>
      </div>
      <Button className="h-12 w-full" type="submit" disabled={busy}>
        <PlusCircle className="h-4 w-4" aria-hidden="true" />
        {busy ? "Saving…" : isEdit ? "Save changes" : "Create fund"}
      </Button>
      <Link
        href={initial ? `/vouchers/funds/${initial.id}` : "/vouchers/funds"}
        className="flex min-h-11 items-center justify-center rounded-control text-sm font-medium text-primary"
      >
        Cancel
      </Link>
    </form>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-2">
      <span className="text-sm font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}
