"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gift } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DEFAULT_TRIAL_DAYS, MAX_TRIAL_DAYS } from "@/lib/subscriptionTrials";

interface GrantTrialControlProps {
  merchantId: string;
  canManage: boolean;
  subscriptionStatus?: string | null;
}

export function GrantTrialControl({ merchantId, canManage, subscriptionStatus }: GrantTrialControlProps) {
  const router = useRouter();
  const [days, setDays] = useState(DEFAULT_TRIAL_DAYS);
  const [submitting, setSubmitting] = useState(false);
  const [isRefreshing, startTransition] = useTransition();
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const isPaid = subscriptionStatus === "active" || subscriptionStatus === "past_due";
  const disabled = submitting || isRefreshing || isPaid || !canManage;

  async function grantTrial() {
    setMessage(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/merchants/${merchantId}/trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setMessage({ kind: "error", text: data.error ?? "Could not grant the trial." });
        return;
      }

      setMessage({ kind: "success", text: `${days}-day trial granted.` });
      startTransition(() => router.refresh());
    } catch {
      setMessage({ kind: "error", text: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex items-start gap-2">
        <Gift className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-slate-800">Onboarding trial</p>
          <p className="mt-0.5 text-xs leading-5 text-ink-muted">
            Give this merchant temporary access while they get set up.
          </p>
        </div>
      </div>

      <div className="mt-3 flex max-w-sm items-end gap-2">
        <label className="min-w-0 flex-1 text-xs font-medium text-ink-muted">
          Days
          <Input
            className="mt-1"
            type="number"
            min={1}
            max={MAX_TRIAL_DAYS}
            step={1}
            value={days}
            disabled={disabled}
            onChange={(event) => setDays(Number(event.target.value))}
          />
        </label>
        <Button
          size="sm"
          disabled={disabled || !Number.isInteger(days) || days < 1 || days > MAX_TRIAL_DAYS}
          onClick={grantTrial}
        >
          {submitting || isRefreshing ? "Granting..." : "Grant trial"}
        </Button>
      </div>

      {isPaid ? <p className="mt-2 text-xs text-ink-muted">Paid subscriptions do not need a trial.</p> : null}
      {!canManage ? <p className="mt-2 text-xs text-ink-muted">You have read-only access.</p> : null}
      {message ? (
        <p
          className={`mt-2 text-xs ${message.kind === "error" ? "text-red-600" : "text-emerald-700"}`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}
