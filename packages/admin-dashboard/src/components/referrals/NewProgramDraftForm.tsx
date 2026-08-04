"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const FIELDS: Array<{ key: string; label: string; defaultValue: number }> = [
  { key: "signup_reward_miles", label: "Signup reward (Miles)", defaultValue: 50 },
  { key: "activation_reward_miles", label: "Activation reward (Miles)", defaultValue: 100 },
  { key: "attribution_window_days", label: "Attribution window (days)", defaultValue: 30 },
  { key: "activation_window_days", label: "Activation window (days)", defaultValue: 30 },
  { key: "signup_hold_hours", label: "Signup hold (hours)", defaultValue: 24 },
  { key: "activation_hold_hours", label: "Activation hold (hours)", defaultValue: 168 },
  { key: "min_purchase_kes", label: "Min qualifying purchase (KES)", defaultValue: 200 },
  { key: "daily_signup_cap", label: "Signup rewards / referrer / 24h", defaultValue: 3 },
  { key: "rolling_30_day_referral_cap", label: "Rewarded referrals / referrer / 30d", defaultValue: 10 },
  { key: "total_budget_miles", label: "Total budget (Miles)", defaultValue: 0 },
];

export function NewProgramDraftForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.key, String(f.defaultValue)]))
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      const body = Object.fromEntries(FIELDS.map((f) => [f.key, Number(values[f.key])]));
      const res = await fetch("/api/admin/referrals/program", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create draft");
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}>New draft version</Button>;
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-slate-900">New draft program version</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {FIELDS.map((f) => (
          <label key={f.key} className="text-xs text-slate-600">
            {f.label}
            <Input
              type="number"
              min={0}
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="mt-1"
            />
          </label>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Published budgets are immutable. Enter the approved budget before publishing; use 0 only for a non-earning dry run.
      </p>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={loading}>
          {loading ? "Creating…" : "Create draft"}
        </Button>
      </div>
    </div>
  );
}
