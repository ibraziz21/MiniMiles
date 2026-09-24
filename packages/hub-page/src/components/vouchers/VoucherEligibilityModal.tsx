"use client";

import { useId, type ReactNode } from "react";
import { Check, CircleAlert, Loader2, ShieldCheck, X } from "lucide-react";
import { useDialogA11y } from "@/hooks/useDialogA11y";
import type { VoucherClaimFriction, VoucherUsePlan } from "@/lib/vouchers/claimIntent";

export type EligibilityRuleView = {
  label: string;
  passed: boolean;
  href?: string;
  cta?: string;
};

const USE_PLAN_OPTIONS: Array<{ value: VoucherUsePlan; label: string }> = [
  { value: "nearby", label: "I’m nearby" },
  { value: "planned_visit", label: "I’ve planned a visit before it expires" },
  { value: "upcoming_trip", label: "I’m travelling there soon" },
  { value: "other", label: "I have another specific plan" },
];

export function VoucherEligibilityModal({
  open,
  state,
  rules,
  error,
  eligibilitySummary,
  merchantName,
  expiryLabel,
  friction,
  intentConfirmed,
  usePlan,
  details,
  confirmLabel,
  onIntentConfirmedChange,
  onUsePlanChange,
  onConfirm,
  onClose,
}: {
  open: boolean;
  state: "checking" | "eligible" | "ineligible" | "submitting" | "error";
  rules: EligibilityRuleView[];
  error?: string | null;
  eligibilitySummary?: string | null;
  merchantName?: string | null;
  expiryLabel?: string | null;
  friction?: VoucherClaimFriction | null;
  intentConfirmed: boolean;
  usePlan: VoucherUsePlan | "";
  details?: ReactNode;
  confirmLabel: ReactNode;
  onIntentConfirmedChange: (checked: boolean) => void;
  onUsePlanChange: (plan: VoucherUsePlan | "") => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const close = state === "submitting" ? undefined : onClose;
  const dialogRef = useDialogA11y<HTMLDivElement>(open, close);
  if (!open) return null;

  const eligible = state === "eligible" || state === "submitting";
  const canConfirm =
    state === "eligible" &&
    intentConfirmed &&
    (!friction?.requiresUsePlan || !!usePlan);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/45 px-0 backdrop-blur-[2px] sm:items-center sm:px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {close && <button type="button" className="absolute inset-0" onClick={close} aria-label="Dismiss" />}
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 shadow-2xl focus:outline-none sm:rounded-[2rem] sm:p-6"
      >
        {close && (
          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-full text-akiba-muted transition hover:bg-akiba-card hover:text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            aria-label="Close eligibility check"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="pr-10">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-akiba-tint text-akiba-teal">
            {state === "checking" ? <Loader2 className="h-5 w-5 animate-spin" /> : eligible ? <ShieldCheck className="h-5 w-5" /> : <CircleAlert className="h-5 w-5" />}
          </span>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-akiba-teal">Before claiming</p>
          <h3 id={titleId} className="mt-1 font-sterling text-2xl font-bold text-akiba-ink">
            {state === "checking" ? "Checking your eligibility" : eligible ? "You qualify for this voucher" : "Eligibility check"}
          </h3>
          {merchantName && <p className="mt-1 text-sm text-akiba-muted">Redeemable at {merchantName}{expiryLabel ? ` · use by ${expiryLabel}` : ""}</p>}
        </div>

        {state === "checking" ? (
          <div className="mt-6 rounded-2xl bg-akiba-card px-4 py-5 text-sm text-akiba-muted">We’re checking the voucher rules and your account.</div>
        ) : state === "error" ? (
          <div role="alert" className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? "We couldn’t check this voucher right now. Please try again."}</div>
        ) : (
          <>
            {eligibilitySummary && <p className="mt-5 rounded-2xl bg-akiba-card px-4 py-3 text-sm text-akiba-ink">{eligibilitySummary}</p>}
            <div className="mt-5 space-y-2" aria-label="Voucher eligibility rules">
              {rules.map((rule) => (
                <div key={rule.label} className="flex items-start gap-3 rounded-xl border border-akiba-line px-3.5 py-3">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${rule.passed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                    {rule.passed ? <Check className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-akiba-ink">{rule.label}</span>
                  {!rule.passed && rule.href && <a href={rule.href} className="shrink-0 text-xs font-semibold text-akiba-teal underline">{rule.cta ?? "Update"}</a>}
                </div>
              ))}
            </div>

            {eligible && (
              <div className="mt-5 border-t border-akiba-line pt-5">
                {friction?.requiresUsePlan && (
                  <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <p className="text-sm font-semibold text-amber-950">A previous voucher expired unused</p>
                    <p className="mt-1 text-xs leading-relaxed text-amber-800">Limited vouchers can prevent someone else from claiming. Tell us how you plan to use this one.</p>
                    <label className="mt-3 block text-xs font-semibold text-amber-950" htmlFor={`${titleId}-plan`}>How will you use it?</label>
                    <select
                      id={`${titleId}-plan`}
                      value={usePlan}
                      onChange={(event) => onUsePlanChange(event.target.value as VoucherUsePlan | "")}
                      disabled={state === "submitting"}
                      className="mt-1.5 min-h-11 w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm text-akiba-ink focus:border-akiba-teal focus:outline-none focus:ring-2 focus:ring-akiba-teal/20"
                    >
                      <option value="">Select a plan</option>
                      {USE_PLAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                )}

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-akiba-line p-4 transition hover:border-akiba-teal/30">
                  <input
                    type="checkbox"
                    checked={intentConfirmed}
                    onChange={(event) => onIntentConfirmedChange(event.target.checked)}
                    disabled={state === "submitting"}
                    className="mt-0.5 h-4 w-4 rounded border-akiba-line text-akiba-teal focus:ring-akiba-teal"
                  />
                  <span className="text-sm leading-relaxed text-akiba-ink">I intend to use this voucher before it expires and understand it cannot be transferred.</span>
                </label>
                {details}
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={!canConfirm}
                  className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-akiba-teal px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-akiba-teal/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2"
                >
                  {state === "submitting" ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</> : confirmLabel}
                </button>
              </div>
            )}
          </>
        )}

        {close && (
          <button type="button" onClick={close} className="mt-2 min-h-11 w-full px-4 py-2 text-sm font-medium text-akiba-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal">
            {state === "ineligible" || state === "error" ? "Close" : "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
