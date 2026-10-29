"use client";

import type { CustomerVoucherEntitlement } from "@/lib/vouchers/customerEntitlement";
import { entitlementBenefit } from "@/lib/vouchers/customerEntitlement";
import { VoucherEntitlementSummary } from "./VoucherEntitlementSummary";

import { useId, type ReactNode, type RefObject } from "react";
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
  entitlement,
  successHref,
  returnFocusRef,
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
  state: "checking" | "eligible" | "ineligible" | "submitting" | "error" | "success";
  rules: EligibilityRuleView[];
  error?: string | null;
  eligibilitySummary?: string | null;
  merchantName?: string | null;
  entitlement?: CustomerVoucherEntitlement;
  successHref?: string;
  returnFocusRef?: RefObject<HTMLElement>;
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
  const dialogRef = useDialogA11y<HTMLDivElement>(open, close, returnFocusRef);
  if (!open) return null;

  const eligible = state === "eligible" || state === "submitting";
  const canConfirm =
    state === "eligible" &&
    intentConfirmed &&
    (!friction?.requiresUsePlan || !!usePlan);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/45 px-0 backdrop-blur-[2px] sm:items-center sm:px-4"
    >
      {close && <button type="button" className="absolute inset-0" tabIndex={-1} aria-hidden="true" onClick={close} aria-label="Dismiss" />}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-busy={state === "submitting"}
        tabIndex={state === "submitting" ? 0 : -1}
        className="relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-t-[2rem] bg-white px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 shadow-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-akiba-tealAccessible sm:rounded-[2rem] sm:p-6"
      >
        {close && (
          <button
            type="button"
            onClick={close}
            className="absolute right-4 top-4 flex min-h-11 min-w-11 items-center justify-center rounded-full text-akiba-muted transition hover:bg-akiba-card hover:text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-tealAccessible"
            aria-label="Close eligibility check"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        <div className="pr-10">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-akiba-tint text-akiba-tealAccessible">
            {state === "checking" ? <Loader2 className="h-5 w-5 animate-spin" /> : state === "success" ? <Check className="h-5 w-5" aria-hidden="true" /> : eligible ? <ShieldCheck className="h-5 w-5" /> : <CircleAlert className="h-5 w-5" />}
          </span>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.18em] text-akiba-tealAccessible">{state === "success" ? "Added to My vouchers" : "Before claiming"}</p>
          <h3 aria-live="polite" id={titleId} className="mt-1 font-sterling text-2xl font-bold text-akiba-ink">
            {state === "success" ? "Voucher claimed" : state === "submitting" ? "Claiming your voucher" : state === "checking" ? "Checking your eligibility" : eligible ? "You qualify for this voucher" : "Eligibility check"}
          </h3>
          {!entitlement && merchantName && <p className="mt-1 text-sm text-akiba-muted">At {merchantName}{expiryLabel ? ` · Claim by ${expiryLabel}` : ""}</p>}
        </div>

        {entitlement && <section className="mt-4 space-y-3" aria-label="Voucher details">
          <p className="font-semibold text-akiba-ink">{entitlementBenefit(entitlement)}</p>
          <VoucherEntitlementSummary entitlement={entitlement} interactive={state !== "submitting"} />
        </section>}
        {state === "success" ? (
          <a href={successHref ?? "/vouchers?tab=active"} className="mt-5 flex min-h-12 items-center justify-center rounded-full bg-akiba-tealAccessible px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-tealAccessible focus-visible:ring-offset-2">View voucher</a>
        ) : state === "checking" ? (
          <div className="mt-6 rounded-2xl bg-akiba-card px-4 py-5 text-sm text-akiba-muted">We’re checking the voucher rules and your account.</div>
        ) : state === "error" ? (
          <div role="alert" className="mt-6 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">{error ?? "We couldn’t check this voucher right now. Please try again."}</div>
        ) : (
          <>
            {eligibilitySummary && <p className="mt-5 rounded-2xl bg-akiba-card px-4 py-3 text-sm text-akiba-ink">{eligibilitySummary}</p>}
            <div className="mt-5 space-y-2" role="list" aria-label="Voucher eligibility rules">
              {rules.map((rule) => (
                <div key={rule.label} role="listitem" className="flex items-start gap-3 rounded-xl border border-akiba-line px-3.5 py-3">
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${rule.passed ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                    {rule.passed ? <Check className="h-3.5 w-3.5" /> : <CircleAlert className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-akiba-ink">{rule.label}</span>
                  {!rule.passed && rule.href && <a href={rule.href} className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-akiba-tealAccessible underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-tealAccessible">{rule.cta ?? "Update"}</a>}
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
                      className="mt-1.5 min-h-11 w-full rounded-xl border border-amber-200 bg-white px-3 py-2.5 text-sm text-akiba-ink focus:border-akiba-tealAccessible focus:outline-none focus:ring-2 focus:ring-akiba-tealAccessible/20"
                    >
                      <option value="">Select a plan</option>
                      {USE_PLAN_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </div>
                )}

                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-akiba-line p-4 transition hover:border-akiba-tealAccessible/30">
                  <input
                    type="checkbox"
                    checked={intentConfirmed}
                    onChange={(event) => onIntentConfirmedChange(event.target.checked)}
                    disabled={state === "submitting"}
                    className="mt-0.5 h-4 w-4 rounded border-akiba-line text-akiba-tealAccessible focus:ring-akiba-tealAccessible"
                  />
                  <span className="text-sm leading-relaxed text-akiba-ink">I intend to use this voucher before it expires and understand it cannot be transferred.</span>
                </label>
                {details}
                <button
                  type="button"
                  onClick={onConfirm}
                  disabled={!canConfirm}
                  className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-akiba-tealAccessible px-4 py-3 text-sm font-semibold text-white transition active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-akiba-card disabled:text-akiba-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-tealAccessible focus-visible:ring-offset-2"
                >
                  {state === "submitting" ? <><Loader2 className="h-4 w-4 animate-spin" /> Processing…</> : confirmLabel}
                </button>
              </div>
            )}
          </>
        )}

        {close && (
          <button type="button" onClick={close} className="mt-2 min-h-11 w-full px-4 py-2 text-sm font-medium text-akiba-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-tealAccessible">
            {state === "ineligible" || state === "error" || state === "success" ? "Close" : "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
