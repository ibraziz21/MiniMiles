"use client";
/* eslint-disable @next/next/no-img-element -- Merchant media uses dynamic public URLs. */

import type { RedemptionSchedule } from "@/lib/redemptionSchedule";

import {
  toNairobiDateTimeInput,
  fromNairobiDateTimeInput,
} from "@/lib/voucherFundDates";
import { useMemo, useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ELIGIBILITY_RULE_TYPES,
  ELIGIBILITY_RULE_LABELS,
  ELIGIBILITY_RULE_WARNINGS,
  VERIFIED_ACTIVITY_TEMPLATE_KEYS,
  WEEKDAY_LABELS,
  WEEKEND_DAYS,
  CLAIM_DAY_TIMEZONE,
  DISTRIBUTION_MODES,
  DISTRIBUTION_MODE_LABELS,
  isValidEligibilityRule,
  type EligibilityRuleType,
} from "@/lib/voucherFunds";
import Link from "next/link";
import { allocationQuantity } from "@/lib/voucherFundNavigation";
import { VoucherFacts, VoucherStatus } from "@/components/vouchers/VoucherUi";
import {
  AlertTriangle,
  Wallet,
  Store,
  LockKeyhole,
  ArrowRight,
  CheckCircle2,
  Pencil,
} from "lucide-react";

export interface MerchantOption {
  id: string;
  name: string;
  country: string | null;
  status: string;
  image_url?: string | null;
  location?: string;
}

export interface AllocationFormInitial {
  id: string;
  version: number;
  merchantName: string;
  title: string;
  description: string;
  termsText: string;
  voucherType: "fixed_off" | "percent_off";
  additionalMerchantIds?: string[];
  /** The primary merchant's id, so it can be excluded from the extras list. */
  merchantPartnerId?: string;
  discountKes: number;
  discountPercent: number | null;
  maximumDiscountKes: number | null;
  minimumSpendKes: number;
  quantityCap: number;
  authorizedBudgetKes: number;
  claimStartsAt: string;
  claimEndsAt: string;
  voucherValidityDays: number;
  distributionModes: string[];
  recycleExpiredInventory: boolean;
  showInBusinessOffers?: boolean;
  redemptionSchedule?: RedemptionSchedule | null;
  eligibilityRules?: Record<string, unknown>[];
  eligibilityMode?: string | null;
  eligibilityCustomerCopy?: string;
}

// Merchant + benefit + eligibility + distribution + funding review, combined
// into one form since the allocation RPC accepts them together. See
// akiba-funded-voucher-admin-spec.md §7.2-§7.6.
export function AllocationForm({
  fundId,
  fundCountryCode,
  merchants,
  initial,
  fundName,
  availableBudgetKes,
  fundStartsAt,
  fundEndsAt,
}: {
  fundId: string;
  fundCountryCode: string;
  merchants: MerchantOption[];
  initial?: AllocationFormInitial;
  fundName?: string;
  availableBudgetKes?: number | null;
  fundStartsAt?: string;
  fundEndsAt?: string;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const [step, setStep] = useState(initial ? 2 : 1);
  const stepHeading = useRef<HTMLHeadingElement>(null),
    previousStep = useRef(step),
    errorSummary = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (previousStep.current !== step) {
      stepHeading.current?.focus();
      stepHeading.current?.scrollIntoView({ block: "start" });
      previousStep.current = step;
    }
  }, [step]);
  const [autoQuantity, setAutoQuantity] = useState(!initial);
  const requestLock = useRef(false);

  const [merchantFilter, setMerchantFilter] = useState("");
  const [merchantId, setMerchantId] = useState(
    initial?.merchantPartnerId ?? ""
  );
  // Additional merchants where this allocation's vouchers may be redeemed
  // (BDR-006). Editable while the allocation is draft — this page only loads
  // for drafts — and fixed once it is submitted for approval.
  const [additionalMerchantIds, setAdditionalMerchantIds] = useState<string[]>(
    initial?.additionalMerchantIds ?? []
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [termsText, setTermsText] = useState(initial?.termsText ?? "");
  // Fixed after creation: switching the benefit shape would change what every
  // already-issued voucher's snapshot means, so the edit form shows it
  // read-only and the PATCH route does not send it.
  const [voucherType, setVoucherType] = useState<"fixed_off" | "percent_off">(
    initial?.voucherType ?? "fixed_off"
  );
  const isPercent = voucherType === "percent_off";
  const [discountKes, setDiscountKes] = useState(
    initial ? String(initial.discountKes) : "500"
  );
  const [discountPercent, setDiscountPercent] = useState(
    initial?.discountPercent != null ? String(initial.discountPercent) : "10"
  );
  const [maximumDiscountKes, setMaximumDiscountKes] = useState(
    initial?.maximumDiscountKes != null
      ? String(initial.maximumDiscountKes)
      : "200"
  );
  const [minimumSpendKes, setMinimumSpendKes] = useState(
    initial ? String(initial.minimumSpendKes) : "1500"
  );
  const [quantityCap, setQuantityCap] = useState(
    initial ? String(initial.quantityCap) : "10"
  );
  const [authorizedBudgetKes, setAuthorizedBudgetKes] = useState(
    initial ? String(initial.authorizedBudgetKes) : ""
  );
  const [claimStartsAt, setClaimStartsAt] = useState(
    initial
      ? toNairobiDateTimeInput(initial.claimStartsAt)
      : fundStartsAt
      ? toNairobiDateTimeInput(fundStartsAt)
      : ""
  );
  const [claimEndsAt, setClaimEndsAt] = useState(
    initial
      ? toNairobiDateTimeInput(initial.claimEndsAt)
      : fundEndsAt
      ? toNairobiDateTimeInput(fundEndsAt)
      : ""
  );
  const [voucherValidityDays, setVoucherValidityDays] = useState(
    initial ? String(initial.voucherValidityDays) : "14"
  );
  const [distributionModes, setDistributionModes] = useState<string[]>(
    initial?.distributionModes ?? ["self_claim"]
  );
  const [recycleExpiredInventory, setRecycleExpiredInventory] = useState(
    initial?.recycleExpiredInventory ?? false
  );
  const savedRules = initial?.eligibilityRules ?? [];
  const savedRule = (type: string) =>
    savedRules.find((rule) => rule.type === type);
  const [selectedRules, setSelectedRules] = useState<Record<string, boolean>>(
    () => ({
      ...(isEdit
        ? Object.fromEntries(
            savedRules.map((rule) => [String(rule.type), true])
          )
        : { pass_activated: true }),
      country_in: true,
      profile_country_set: true,
    })
  );
  const [minAccountAgeDays, setMinAccountAgeDays] = useState(
    String(savedRule("minimum_account_age_days")?.days ?? 7)
  );
  const [verifiedActivityKey, setVerifiedActivityKey] = useState(
    String(
      savedRule("verified_activity_completed")?.templateKey ??
        VERIFIED_ACTIVITY_TEMPLATE_KEYS[0]
    )
  );
  const [cooldownDays, setCooldownDays] = useState(
    String(savedRule("fund_claim_cooldown")?.days ?? 30)
  );
  const [claimDays, setClaimDays] = useState<number[]>(() => {
    const days = savedRule("claim_day_of_week")?.days;
    return Array.isArray(days) ? (days as number[]) : [...WEEKEND_DAYS];
  });
  const claimTimezone = String(
    savedRule("claim_day_of_week")?.timezone ?? CLAIM_DAY_TIMEZONE
  );
  const [customerCopy, setCustomerCopy] = useState(
    initial?.eligibilityCustomerCopy ?? ""
  );
  // Never silently discard a legacy rule or change an ANY policy to ALL.
  const unsupportedSavedPolicy =
    isEdit &&
    ((initial?.eligibilityMode != null && initial.eligibilityMode !== "all") ||
      savedRules.some((rule) => !isValidEligibilityRule(rule)) ||
      new Set(savedRules.map((rule) => rule.type)).size !== savedRules.length);
  const [showInBusinessOffers, setShowInBusinessOffers] = useState(
    initial?.showInBusinessOffers ?? false
  );
  const [restrictRedemption, setRestrictRedemption] = useState(
    Boolean(initial?.redemptionSchedule)
  );
  const [redemptionDays, setRedemptionDays] = useState<number[]>(
    initial?.redemptionSchedule?.days ?? [...WEEKEND_DAYS]
  );
  const [redemptionStartDate, setRedemptionStartDate] = useState(
    initial?.redemptionSchedule?.startDate ?? ""
  );
  const [redemptionEndDate, setRedemptionEndDate] = useState(
    initial?.redemptionSchedule?.endDate ?? ""
  );
  const redemptionTimezone =
    initial?.redemptionSchedule?.timezone ?? CLAIM_DAY_TIMEZONE;
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (error) {
      errorSummary.current?.focus();
      errorSummary.current?.scrollIntoView({ block: "center" });
    }
  }, [error]);

  // The commitment floor is quantity × the WORST CASE per voucher. For a
  // percentage benefit that worst case is the cap, not the expected discount —
  // the fund reserves the ceiling at claim time and releases the unused part
  // when the till reports the real basket.
  const perVoucherCeiling = isPercent
    ? Number(maximumDiscountKes || 0)
    : Number(discountKes || 0);
  const floorBudget = Number(quantityCap || 0) * perVoucherCeiling;
  useEffect(() => {
    if (
      autoQuantity &&
      Number(authorizedBudgetKes) > 0 &&
      perVoucherCeiling > 0
    )
      setQuantityCap(
        String(
          allocationQuantity(Number(authorizedBudgetKes), perVoucherCeiling)
        )
      );
  }, [autoQuantity, authorizedBudgetKes, perVoucherCeiling]);
  const selectedMerchant = merchants.find(
    (merchant) => merchant.id === merchantId
  );
  const remainingBudget =
    availableBudgetKes != null
      ? availableBudgetKes - Number(authorizedBudgetKes || 0)
      : null;

  const filteredMerchants = useMemo(() => {
    const q = merchantFilter.trim().toLowerCase();
    if (!q) return merchants;
    return merchants.filter(
      (m) =>
        m.name.toLowerCase().includes(q) || m.country?.toLowerCase().includes(q)
    );
  }, [merchants, merchantFilter]);

  function toggleAdditionalMerchant(id: string) {
    setAdditionalMerchantIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    );
  }

  function toggleMode(mode: string) {
    setDistributionModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]
    );
  }
  // country_in and profile_country_set together express the mandatory
  // profile-country gate every funded allocation inherits from its program
  // (profile-country-eligibility spec §7.2) — a system invariant the Admin
  // cannot create, toggle, or delete, not an operator-selectable rule.
  function toggleRule(type: string) {
    if (type === "country_in" || type === "profile_country_set") return;
    setSelectedRules((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  function buildRules() {
    const rules: Record<string, unknown>[] = [
      { type: "country_in", countries: [fundCountryCode] },
      { type: "profile_country_set" },
    ];
    if (selectedRules.pass_activated) rules.push({ type: "pass_activated" });
    if (selectedRules.minimum_account_age_days) {
      // Canonical field is `days`, required > 0 — `|| 0` previously let a
      // blank/NaN input silently become "no minimum" (corrective-hardening-
      // pass item 3). onSubmit rejects an invalid value before this ever
      // reaches the request.
      rules.push({
        type: "minimum_account_age_days",
        days: Number(minAccountAgeDays),
      });
    }
    if (selectedRules.verified_activity_completed) {
      rules.push({
        type: "verified_activity_completed",
        templateKey: verifiedActivityKey,
      });
    }
    if (selectedRules.first_funded_voucher)
      rules.push({ type: "first_funded_voucher" });
    if (selectedRules.no_prior_merchant_redemption)
      rules.push({ type: "no_prior_merchant_redemption" });
    if (selectedRules.fund_claim_cooldown) {
      // Canonical field is `days` — Platform's evaluator and rule-set-creation
      // RPC both read `days` only; the legacy `cooldownSeconds` this used to
      // send was silently ignored server-side (runtime-hardening-spec.md
      // Phase 1 item 6).
      rules.push({ type: "fund_claim_cooldown", days: Number(cooldownDays) });
    }
    if (selectedRules.claim_day_of_week) {
      // `days` is a weekday list (0=Sunday … 6=Saturday), and the timezone is
      // sent explicitly: "Saturday" is a local-calendar claim, and a Nairobi
      // Saturday opens at 21:00 UTC on Friday.
      rules.push({
        type: "claim_day_of_week",
        days: [...claimDays].sort((a, b) => a - b),
        timezone: claimTimezone,
      });
    }
    return rules;
  }

  function toggleClaimDay(day: number) {
    setClaimDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  }

  function isValidBoundedDays(value: string, maxDays: number): boolean {
    if (value.trim() === "") return false;
    const n = Number(value);
    return Number.isFinite(n) && Number.isInteger(n) && n > 0 && n <= maxDays;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (step === 1) {
      if (
        !isEdit &&
        (!selectedMerchant || selectedMerchant.status !== "active")
      ) {
        setError("Select an active merchant.");
        return;
      }
      if (
        !Number.isFinite(Number(authorizedBudgetKes)) ||
        Number(authorizedBudgetKes) <= 0
      ) {
        setError("Enter an allocation budget.");
        return;
      }
      if (
        !isEdit &&
        availableBudgetKes != null &&
        Number(authorizedBudgetKes) > availableBudgetKes
      ) {
        setError("The allocation exceeds the available fund budget.");
        return;
      }
      setStep(2);
      return;
    }

    if (restrictRedemption && redemptionDays.length === 0) {
      setError(
        "Select at least one day on which this voucher can be redeemed."
      );
      return;
    }
    if (unsupportedSavedPolicy) {
      setError(
        "This allocation has a legacy or unsupported eligibility policy. It must be reviewed before editing; no saved rules have been changed."
      );
      return;
    }

    if (
      selectedRules.fund_claim_cooldown &&
      !isValidBoundedDays(cooldownDays, 365)
    ) {
      setError("Cooldown must be a whole number of days between 1 and 365.");
      return;
    }
    if (
      selectedRules.minimum_account_age_days &&
      !isValidBoundedDays(minAccountAgeDays, 3650)
    ) {
      setError(
        "Minimum account age must be a whole number of days between 1 and 3650."
      );
      return;
    }
    if (selectedRules.claim_day_of_week && claimDays.length === 0) {
      setError(
        "Select at least one day of the week the voucher can be claimed on."
      );
      return;
    }
    if (isPercent) {
      const percent = Number(discountPercent);
      if (!Number.isFinite(percent) || percent <= 0 || percent > 100) {
        setError("Discount percent must be between 0 and 100.");
        return;
      }
      const cap = Number(maximumDiscountKes);
      if (!Number.isFinite(cap) || cap <= 0) {
        setError("A percentage benefit needs a maximum discount in KES.");
        return;
      }
      if (Number(minimumSpendKes) <= cap) {
        setError("Minimum purchase must be greater than the maximum discount.");
        return;
      }
    }

    if (
      restrictRedemption &&
      (redemptionStartDate || redemptionEndDate) &&
      (!redemptionStartDate ||
        !redemptionEndDate ||
        redemptionStartDate > redemptionEndDate)
    ) {
      setError("Choose both event dates, with the end on or after the start.");
      return;
    }
    if (
      !Number.isInteger(Number(quantityCap)) ||
      Number(quantityCap) < 1 ||
      floorBudget > Number(authorizedBudgetKes)
    ) {
      setError("The quantity must fit within this allocation’s budget.");
      return;
    }
    if (distributionModes.length === 0) {
      setError("Choose at least one distribution mode.");
      return;
    }
    try {
      const start = Date.parse(fromNairobiDateTimeInput(claimStartsAt)),
        end = Date.parse(fromNairobiDateTimeInput(claimEndsAt));
      if (
        end <= start ||
        (fundStartsAt && start < Date.parse(fundStartsAt)) ||
        (fundEndsAt && end > Date.parse(fundEndsAt))
      ) {
        setError(
          "The claim window must fit inside the fund’s dates, with its end after its start."
        );
        return;
      }
    } catch {
      setError("Choose valid claim window dates and times.");
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    if (requestLock.current) return;
    requestLock.current = true;
    setBusy(true);
    try {
      let eligibilityRuleSetId: string | undefined;
      const rules = buildRules();
      if (rules.length > 0) {
        const ruleRes = await fetch(
          `/api/admin/voucher-funds/${fundId}/eligibility-rule-sets`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: "all", rules, customerCopy }),
          }
        );
        const ruleResult = await ruleRes.json();
        if (!ruleRes.ok) {
          setBusy(false);
          setError(ruleResult.error ?? "Failed to save eligibility rules.");
          return;
        }
        eligibilityRuleSetId = ruleResult.data.id;
      }

      const body: Record<string, unknown> = {
        title,
        description,
        termsText,
        showInBusinessOffers,
        redemptionSchedule: restrictRedemption
          ? {
              days: [...redemptionDays].sort((a, b) => a - b),
              timezone: redemptionTimezone,
              ...(redemptionStartDate || redemptionEndDate
                ? { startDate: redemptionStartDate, endDate: redemptionEndDate }
                : {}),
            }
          : null,
        discountKes: isPercent ? undefined : Number(discountKes),
        discountPercent: isPercent ? Number(discountPercent) : undefined,
        maximumDiscountKes: isPercent ? Number(maximumDiscountKes) : undefined,
        minimumSpendKes: Number(minimumSpendKes),
        quantityCap: Number(quantityCap),
        authorizedBudgetKes: authorizedBudgetKes
          ? Number(authorizedBudgetKes)
          : undefined,
        claimStartsAt: fromNairobiDateTimeInput(claimStartsAt),
        claimEndsAt: fromNairobiDateTimeInput(claimEndsAt),
        voucherValidityDays: Number(voucherValidityDays),
        distributionModes,
        recycleExpiredInventory,
        eligibilityRuleSetId,
        notes,
      };

      let res;
      if (isEdit) {
        body.expectedVersion = initial!.version;
        // Always sent on a draft edit: the form shows the persisted set, so the
        // array it holds IS the intended one, including empty. Omitting the key
        // means "don't touch membership", which is not what a submit means.
        body.additionalMerchantIds = additionalMerchantIds;
        res = await fetch(`/api/admin/voucher-allocations/${initial!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        body.merchantId = merchantId;
        body.voucherType = voucherType;
        body.additionalMerchantIds = additionalMerchantIds;
        res = await fetch(`/api/admin/voucher-funds/${fundId}/allocations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      const result = await res.json();
      setBusy(false);
      if (!res.ok) {
        setError(result.error ?? "Failed to save allocation.");
        return;
      }
      router.push(
        `/vouchers/funds/${fundId}/allocations/${result.data.id}/review`
      );
      router.refresh();
    } catch {
      setError(
        "Couldn’t save the allocation. Check your connection and retry."
      );
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
      className="mx-auto max-w-3xl space-y-5 p-4 sm:p-6 [&_input:not([type=checkbox]):not([type=radio])]:min-h-12 [&_input:not([type=checkbox]):not([type=radio])]:min-w-0 [&_input:not([type=checkbox]):not([type=radio])]:border-0 [&_input:not([type=checkbox]):not([type=radio])]:bg-[#F2F3FF] [&_input:not([type=checkbox]):not([type=radio])]:text-base [&_select]:min-h-12 [&_select]:w-full [&_select]:min-w-0 [&_select]:rounded-control [&_select]:border-0 [&_select]:bg-[#F2F3FF] [&_select]:text-base [&_textarea]:bg-[#F2F3FF] [&_textarea]:text-base [&_input[type=checkbox]]:h-5 [&_input[type=checkbox]]:w-5 [&_input[type=radio]]:h-5 [&_input[type=radio]]:w-5"
    >
      <div>
        <div className="flex items-center justify-between gap-3 text-sm">
          <p className="font-medium text-primary-strong">Step {step} of 3</p>
          <p className="text-ink-muted">
            {step === 1
              ? "Next: Voucher rules"
              : step === 2
              ? "Next: Review"
              : "Review allocation"}
          </p>
        </div>
        <progress
          value={step}
          max={3}
          aria-label="Allocation setup progress"
          className="mt-3 h-1.5 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-[#EAEDFF] [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
        />
      </div>
      <h2
        ref={stepHeading}
        tabIndex={-1}
        className="scroll-mt-24 text-2xl font-semibold tracking-tight outline-none"
      >
        {step === 1
          ? "Fund allocation"
          : step === 2
          ? "Voucher rules"
          : "Review allocation"}
      </h2>
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
      {unsupportedSavedPolicy && (
        <p
          role="alert"
          className="rounded-control bg-red-50 p-3 text-sm text-danger"
        >
          Saved eligibility needs review. This draft cannot be edited here
          without changing unsupported rules.
        </p>
      )}
      <fieldset disabled={busy} className="space-y-5">
        {step === 1 && (
          <section className="space-y-5 rounded-card bg-white p-5 shadow-sm">
            {!isEdit && (
              <>
                <div className="space-y-3">
                  <Input
                    aria-label="Search merchants"
                    placeholder="Search name or country…"
                    value={merchantFilter}
                    onChange={(event) => setMerchantFilter(event.target.value)}
                  />
                  <Field label="Select merchant">
                    <select
                      required
                      value={merchantId}
                      onChange={(e) => {
                        setMerchantId(e.target.value);
                        setAdditionalMerchantIds((ids) =>
                          ids.filter((id) => id !== e.target.value)
                        );
                      }}
                      aria-label="Merchant"
                    >
                      <option value="">Select a merchant…</option>
                      {filteredMerchants.map((m) => (
                        <option
                          key={m.id}
                          value={m.id}
                          disabled={m.status !== "active"}
                        >
                          {m.name} · {m.country ?? "—"}
                          {m.status !== "active" ? ` (${m.status})` : ""}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </>
            )}
            {(selectedMerchant || initial) && (
              <div className="flex items-center gap-3 rounded-control bg-[#F2F3FF] p-3">
                {selectedMerchant?.image_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */ <img
                    src={selectedMerchant.image_url}
                    alt=""
                    width={48}
                    height={48}
                    className="h-12 w-12 shrink-0 rounded-control object-cover"
                  />
                ) : (
                  <Store
                    className="h-6 w-6 shrink-0 text-primary"
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-semibold">
                    {selectedMerchant?.name || initial?.merchantName}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {selectedMerchant?.location || selectedMerchant?.country}
                  </p>
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label
                htmlFor="allocation-budget"
                className="text-sm font-medium"
              >
                Allocation budget (KES)
              </label>
              <div className="flex items-center gap-2 rounded-control bg-[#F2F3FF] px-3">
                <span className="text-sm text-ink-muted">KES</span>
                <Input
                  id="allocation-budget"
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={authorizedBudgetKes}
                  onChange={(e) => setAuthorizedBudgetKes(e.target.value)}
                  className="!shadow-none"
                />
                {availableBudgetKes != null && availableBudgetKes > 0 && (
                  <button
                    type="button"
                    onClick={() =>
                      setAuthorizedBudgetKes(String(availableBudgetKes))
                    }
                    className="min-h-11 rounded-control bg-[#E2E7FF] px-3 text-sm font-medium text-primary"
                  >
                    MAX
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-primary/10 p-3 text-sm text-primary-strong">
              <span className="flex items-center gap-2">
                <Wallet className="h-5 w-5" aria-hidden="true" />
                Available in fund
              </span>
              <strong>
                {availableBudgetKes != null
                  ? `KES ${availableBudgetKes.toLocaleString()}`
                  : "Unavailable"}
              </strong>
            </div>
            {remainingBudget != null && (
              <p className="flex flex-wrap justify-between gap-2 text-sm">
                <span className="text-ink-muted">
                  Remaining after allocation
                </span>
                <strong className={remainingBudget < 0 ? "text-danger" : ""}>
                  KES {remainingBudget.toLocaleString()}
                </strong>
              </p>
            )}
            {availableBudgetKes != null && availableBudgetKes > 0 && (
              <div className="rounded-control bg-[#F2F3FF] p-3">
                <p className="flex justify-between text-sm">
                  <span>Pool utilization</span>
                  <span>
                    {Math.min(
                      100,
                      Math.round(
                        (Number(authorizedBudgetKes || 0) /
                          availableBudgetKes) *
                          1000
                      ) / 10
                    )}
                    %
                  </span>
                </p>
                <progress
                  aria-label="Planned allocation share of available fund"
                  value={Number(authorizedBudgetKes || 0)}
                  max={availableBudgetKes}
                  className="mt-3 h-2 w-full overflow-hidden rounded-full [&::-webkit-progress-bar]:bg-[#EAEDFF] [&::-webkit-progress-value]:bg-primary"
                />
              </div>
            )}
          </section>
        )}
        {step === 1 && (
          <p className="text-sm leading-6 text-ink-muted">
            Budget is checked again when saved. Creating a draft does not
            publish vouchers.
          </p>
        )}
        {step === 2 && (
          <>
            <div className="flex items-start gap-3 rounded-card bg-[#E2E7FF] p-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-primary text-white">
                <LockKeyhole className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-ink-muted">Allocation budget</p>
                <p className="mt-1 font-semibold">
                  {selectedMerchant?.name || initial?.merchantName}
                </p>
                <p className="mt-1 text-sm">
                  KES {Number(authorizedBudgetKes).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="min-h-11 text-sm font-medium text-primary"
              >
                Change
              </button>
            </div>
            <section className="space-y-4 rounded-card bg-white p-5 shadow-sm">
              <Field label="Voucher name">
                <Input
                  required
                  maxLength={200}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>
              <Field label="Customer benefit">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-control border-0 p-3 text-base focus-visible:ring-2 focus-visible:ring-primary"
                />
              </Field>
              <Field label="Benefit type">
                {isEdit ? (
                  <p className="py-2 text-sm">
                    {isPercent ? "Percentage off" : "Flat KES off"} (fixed after
                    creation)
                  </p>
                ) : (
                  <select
                    value={voucherType}
                    onChange={(e) =>
                      setVoucherType(
                        e.target.value as "fixed_off" | "percent_off"
                      )
                    }
                  >
                    <option value="fixed_off">Flat KES off</option>
                    <option value="percent_off">Percentage off</option>
                  </select>
                )}
              </Field>
              <div className="grid grid-cols-2 gap-3">
                {isPercent ? (
                  <>
                    <Field label="Discount (%)">
                      <Input
                        required
                        type="number"
                        min="0.01"
                        max="100"
                        step="0.01"
                        value={discountPercent}
                        onChange={(e) => setDiscountPercent(e.target.value)}
                      />
                    </Field>
                    <Field label="Maximum discount (KES)">
                      <Input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={maximumDiscountKes}
                        onChange={(e) => setMaximumDiscountKes(e.target.value)}
                      />
                    </Field>
                  </>
                ) : (
                  <Field label="Voucher value (KES)">
                    <Input
                      required
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={discountKes}
                      onChange={(e) => setDiscountKes(e.target.value)}
                    />
                  </Field>
                )}
                <Field label="Voucher quantity">
                  <Input
                    required
                    type="number"
                    min="1"
                    step="1"
                    value={quantityCap}
                    readOnly={autoQuantity}
                    onChange={(e) => setQuantityCap(e.target.value)}
                  />
                </Field>
              </div>

              <div className="rounded-control bg-[#EAEDFF] p-3 text-sm">
                KES {Number(authorizedBudgetKes || 0).toLocaleString()} / KES{" "}
                {perVoucherCeiling.toLocaleString()} ={" "}
                {allocationQuantity(
                  Number(authorizedBudgetKes),
                  perVoucherCeiling
                )}{" "}
                vouchers maximum
              </div>
              <Field label="Minimum purchase (KES)">
                <Input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={minimumSpendKes}
                  onChange={(e) => setMinimumSpendKes(e.target.value)}
                />
              </Field>
            </section>
            <section className="space-y-4 rounded-card bg-white p-5 shadow-sm">
              <h3 className="font-semibold">Eligibility & validity</h3>
              <p className="rounded-control bg-[#F2F3FF] p-3 text-sm">
                Profile country: {fundCountryCode}
                {selectedRules.pass_activated ? " · Akiba Pass activated" : ""}.
                All selected eligibility rules apply.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Claim window starts (EAT)">
                  <Input
                    required
                    type="datetime-local"
                    value={claimStartsAt}
                    onChange={(e) => setClaimStartsAt(e.target.value)}
                  />
                </Field>
                <Field label="Claim window ends (EAT)">
                  <Input
                    required
                    type="datetime-local"
                    min={claimStartsAt || undefined}
                    value={claimEndsAt}
                    onChange={(e) => setClaimEndsAt(e.target.value)}
                  />
                </Field>
              </div>
            </section>
            <details className="rounded-card bg-white p-4 shadow-sm">
              <summary className="min-h-11 cursor-pointer font-medium focus-visible:outline-primary">
                More options
              </summary>
              <div className="mt-4 space-y-4">
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={autoQuantity}
                    onChange={(e) => setAutoQuantity(e.target.checked)}
                  />
                  Calculate quantity from budget
                </label>
                <Field label="Voucher validity after claim (days)">
                  <Input
                    required
                    type="number"
                    min="1"
                    value={voucherValidityDays}
                    onChange={(e) => setVoucherValidityDays(e.target.value)}
                  />
                </Field>
                <Card>
                  <CardHeader>
                    <CardTitle>Also redeemable at</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <fieldset>
                      <legend className="sr-only">Additional merchants</legend>
                      {isEdit && (
                        <Input
                          className="mb-2"
                          placeholder="Search merchants by name or country"
                          value={merchantFilter}
                          onChange={(e) => setMerchantFilter(e.target.value)}
                        />
                      )}
                      <p className="mb-2 text-xs text-ink-muted">
                        One voucher, usable at any merchant ticked here or the
                        one above — the member spends it once, wherever they go
                        first. Leave empty for a single-merchant offer. Fixed
                        once the allocation leaves draft.
                      </p>
                      <div className="max-h-56 space-y-1.5 overflow-y-auto">
                        {filteredMerchants
                          .filter(
                            (m) => m.id !== merchantId && m.status === "active"
                          )
                          .map((m) => (
                            <label
                              key={m.id}
                              className="flex items-center gap-2 text-sm text-ink"
                            >
                              <input
                                type="checkbox"
                                checked={additionalMerchantIds.includes(m.id)}
                                onChange={() => toggleAdditionalMerchant(m.id)}
                                className="h-4 w-4 accent-primary"
                              />
                              <span className="truncate">
                                {m.name}{" "}
                                <span className="text-ink-muted">
                                  · {m.country ?? "—"}
                                </span>
                              </span>
                            </label>
                          ))}
                      </div>
                      {additionalMerchantIds.length > 0 && (
                        <p className="mt-2 text-xs font-medium text-ink">
                          Redeemable at {additionalMerchantIds.length + 1}{" "}
                          merchants in total.
                        </p>
                      )}
                    </fieldset>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Eligibility to claim</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-card border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-900">
                      Members must match <strong>all</strong> selected rules.
                      Country is locked to the fund ({fundCountryCode}).
                    </div>
                    <div className="rounded-card border border-border bg-slate-50 px-3 py-2 text-sm text-ink">
                      <strong>Required:</strong> Member profile country must be{" "}
                      {fundCountryCode}. This is a system invariant enforced by
                      the database on every claim — it cannot be removed or
                      overridden here.
                    </div>
                    {/* not_blocked has no restriction source behind it yet and can
                never be created for a new allocation (runtime-hardening-spec.md
                §4.3) — it stays in ELIGIBILITY_RULE_TYPES only so a
                historical allocation that already references it still has a
                label to render elsewhere; it is never offered here. */}
                    {ELIGIBILITY_RULE_TYPES.filter(
                      (type) => type !== "not_blocked"
                    ).map((type) => (
                      <RuleRow
                        key={type}
                        type={type}
                        checked={
                          type === "profile_country_set"
                            ? true
                            : Boolean(selectedRules[type])
                        }
                        onToggle={() => toggleRule(type)}
                        disabled={
                          type === "country_in" ||
                          type === "profile_country_set"
                        }
                      >
                        {type === "country_in" && (
                          <Input
                            className="mt-2 max-w-xs"
                            aria-label="Required profile country"
                            value={fundCountryCode}
                            readOnly
                          />
                        )}
                        {type === "minimum_account_age_days" && (
                          <Input
                            className="mt-2 max-w-[120px]"
                            type="number"
                            min="1"
                            max="3650"
                            step="1"
                            aria-label="Minimum account age (days)"
                            value={minAccountAgeDays}
                            onChange={(e) =>
                              setMinAccountAgeDays(e.target.value)
                            }
                          />
                        )}
                        {type === "verified_activity_completed" && (
                          <select
                            value={verifiedActivityKey}
                            onChange={(e) =>
                              setVerifiedActivityKey(e.target.value)
                            }
                            aria-label="Verified activity type"
                            className="mt-2 rounded border border-border px-2 py-1 text-sm"
                          >
                            {VERIFIED_ACTIVITY_TEMPLATE_KEYS.map((key) => (
                              <option key={key} value={key}>
                                {key}
                              </option>
                            ))}
                          </select>
                        )}
                        {type === "fund_claim_cooldown" && (
                          <Input
                            className="mt-2 max-w-[120px]"
                            type="number"
                            min="1"
                            max="365"
                            step="1"
                            aria-label="Fund claim cooldown (days)"
                            value={cooldownDays}
                            onChange={(e) => setCooldownDays(e.target.value)}
                          />
                        )}
                        {type === "claim_day_of_week" && (
                          <fieldset className="mt-2">
                            <legend className="sr-only">
                              Days the voucher can be claimed
                            </legend>
                            <div className="flex flex-wrap gap-x-4 gap-y-2">
                              {WEEKDAY_LABELS.map((label, day) => (
                                <label
                                  key={label}
                                  className="flex items-center gap-1.5 text-sm text-ink"
                                >
                                  <input
                                    type="checkbox"
                                    checked={claimDays.includes(day)}
                                    onChange={() => toggleClaimDay(day)}
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                            <p className="mt-1.5 text-xs text-ink-muted">
                              Evaluated in {claimTimezone}. These days restrict
                              when members can claim; they do not restrict when
                              a voucher can be redeemed.
                            </p>
                          </fieldset>
                        )}
                      </RuleRow>
                    ))}
                    <Field label="Customer-facing eligibility summary">
                      <Input
                        value={customerCopy}
                        onChange={(e) => setCustomerCopy(e.target.value)}
                        placeholder="Available to Kenya members who activated their Akiba Pass…"
                      />
                    </Field>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Redemption schedule</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={showInBusinessOffers}
                        onChange={(event) =>
                          setShowInBusinessOffers(event.target.checked)
                        }
                      />
                      Show in Business offers
                    </label>
                    <p className="text-sm text-ink-muted">
                      Show this funded voucher on the business’s Offers page.
                      Members can set a reminder for the next opening.
                    </p>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={restrictRedemption}
                        onChange={(event) =>
                          setRestrictRedemption(event.target.checked)
                        }
                      />
                      Restrict which days the voucher can be used
                    </label>
                    {restrictRedemption && (
                      <fieldset>
                        <legend className="mb-2 text-sm font-medium">
                          Allowed redemption days
                        </legend>
                        <div className="mb-3 grid gap-3 sm:grid-cols-2">
                          <Field label="Event starts (optional)">
                            <Input
                              type="date"
                              value={redemptionStartDate}
                              onChange={(e) =>
                                setRedemptionStartDate(e.target.value)
                              }
                              required={!!redemptionEndDate}
                            />
                          </Field>
                          <Field label="Event ends (optional)">
                            <Input
                              type="date"
                              value={redemptionEndDate}
                              onChange={(e) =>
                                setRedemptionEndDate(e.target.value)
                              }
                              required={!!redemptionStartDate}
                              min={redemptionStartDate || undefined}
                            />
                          </Field>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {WEEKDAY_LABELS.map((label, day) => (
                            <label
                              key={label}
                              className="flex min-h-11 items-center gap-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={redemptionDays.includes(day)}
                                onChange={() =>
                                  setRedemptionDays((days) =>
                                    days.includes(day)
                                      ? days.filter((value) => value !== day)
                                      : [...days, day]
                                  )
                                }
                              />
                              {label}
                            </label>
                          ))}
                        </div>
                      </fieldset>
                    )}
                    <p className="text-sm text-ink-muted">
                      {restrictRedemption
                        ? `Enforced at merchant checkout in ${redemptionTimezone}.`
                        : "Vouchers can be used on any day while valid."}{" "}
                      To allow claims now and use only on weekends, select Sat
                      and Sun here and leave the claim-day eligibility rule
                      unselected.
                    </p>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Distribution & notes</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {DISTRIBUTION_MODES.map((mode) => (
                      <label
                        key={mode}
                        className="flex min-h-11 items-center gap-3 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={distributionModes.includes(mode)}
                          onChange={() => toggleMode(mode)}
                          disabled={mode === "auto_award"}
                        />
                        {DISTRIBUTION_MODE_LABELS[mode]}
                      </label>
                    ))}
                    <label className="flex min-h-11 items-center gap-3 text-sm">
                      <input
                        type="checkbox"
                        checked={recycleExpiredInventory}
                        onChange={(e) =>
                          setRecycleExpiredInventory(e.target.checked)
                        }
                      />
                      Recycle expired inventory
                    </label>
                    <Field label="Terms">
                      <textarea
                        rows={2}
                        value={termsText}
                        onChange={(e) => setTermsText(e.target.value)}
                        className="w-full rounded-control p-3 text-base focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    </Field>
                    <Field label="Internal notes">
                      <textarea
                        rows={2}
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full rounded-control p-3 text-base focus-visible:ring-2 focus-visible:ring-primary"
                      />
                    </Field>
                  </CardContent>
                </Card>
              </div>
            </details>
          </>
        )}
        {step === 3 && (
          <>
            <div className="flex items-center gap-3 rounded-card bg-white p-4 shadow-sm">
              <Store
                className="h-6 w-6 shrink-0 text-primary"
                aria-hidden="true"
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {selectedMerchant?.name || initial?.merchantName}
                </p>
                <p className="text-sm text-ink-muted">
                  {selectedMerchant?.location || selectedMerchant?.country}
                </p>
              </div>
              <VoucherStatus status={selectedMerchant?.status || "active"} />
            </div>
            <section className="rounded-card bg-white p-5 shadow-sm">
              <h3 className="mb-5 font-semibold">Allocation breakdown</h3>
              <VoucherFacts
                items={[
                  {
                    label: "Merchant",
                    value: selectedMerchant?.name || initial?.merchantName,
                  },
                  { label: "Voucher", value: title },
                  {
                    label: "Benefit",
                    value:
                      description ||
                      `${
                        isPercent
                          ? `${discountPercent}% off (max KES ${maximumDiscountKes})`
                          : `KES ${discountKes} off`
                      }`,
                  },
                  {
                    label: "Allocated budget",
                    value: `KES ${Number(
                      authorizedBudgetKes
                    ).toLocaleString()}`,
                  },
                  {
                    label: "Voucher quantity",
                    value: `${quantityCap} vouchers (KES ${perVoucherCeiling.toLocaleString()} ceiling each)`,
                  },
                  {
                    label: "Eligibility",
                    value: buildRules()
                      .map(
                        (rule) =>
                          ELIGIBILITY_RULE_LABELS[
                            rule.type as EligibilityRuleType
                          ]
                      )
                      .join(" · "),
                  },
                  {
                    label: "Claim window (EAT)",
                    value: `${claimStartsAt.replace(
                      "T",
                      " "
                    )} – ${claimEndsAt.replace("T", " ")}`,
                  },
                  { label: "Parent fund", value: fundName || fundId },
                ]}
              />
              <button
                type="button"
                onClick={() => setStep(2)}
                className="mt-4 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                Edit voucher rules
              </button>
            </section>
            <div className="flex items-start gap-3 rounded-card bg-[#F2F3FF] p-4">
              <CheckCircle2
                className="h-5 w-5 shrink-0 text-primary"
                aria-hidden="true"
              />
              <p className="text-sm text-ink-muted">
                Saving creates a draft. Submission and publication
                follow on the next screen.
              </p>
            </div>
          </>
        )}
      </fieldset>
      <Button
        type="submit"
        disabled={busy || Boolean(unsupportedSavedPolicy)}
        className="h-12 w-full"
      >
        {busy
          ? "Saving…"
          : step === 1
          ? "Continue to voucher rules"
          : step === 2
          ? "Review allocation"
          : isEdit
          ? "Save changes"
          : "Create draft allocation"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
      {step > 1 ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setError(null);
            setStep(step - 1);
          }}
          className="flex min-h-12 w-full items-center justify-center rounded-control bg-[#EAEDFF] text-sm font-medium focus-visible:ring-2 focus-visible:ring-primary"
        >
          {step === 2 ? "Back to allocation" : "Back to voucher rules"}
        </button>
      ) : (
        <Link
          href={`/vouchers/funds/${fundId}`}
          className="flex min-h-11 items-center justify-center rounded-control text-sm font-medium text-primary"
        >
          Cancel
        </Link>
      )}
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

function RuleRow({
  type,
  checked,
  onToggle,
  disabled = false,
  children,
}: {
  type: EligibilityRuleType;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) {
  const warning = ELIGIBILITY_RULE_WARNINGS[type];
  return (
    <div className="rounded-card border border-slate-100 px-3 py-2">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          disabled={disabled}
        />
        {ELIGIBILITY_RULE_LABELS[type]}
      </label>
      {warning && (
        <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {warning}
        </p>
      )}
      {checked && children}
    </div>
  );
}
