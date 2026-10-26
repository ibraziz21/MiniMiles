"use client";

import type { RedemptionSchedule } from "@/lib/redemptionSchedule";

import { useMemo, useState } from "react";
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
import { AlertTriangle } from "lucide-react";

export interface MerchantOption {
  id: string;
  name: string;
  country: string | null;
  status: string;
}

export interface AllocationFormInitial {
  id: string;
  version: number;
  merchantName: string;
  title: string;
  description: string;
  termsText: string;
  voucherType: "fixed_off" | "percent_off";
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
}: {
  fundId: string;
  fundCountryCode: string;
  merchants: MerchantOption[];
  initial?: AllocationFormInitial;
}) {
  const router = useRouter();
  const isEdit = Boolean(initial);
  const [merchantFilter, setMerchantFilter] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [termsText, setTermsText] = useState(initial?.termsText ?? "");
  // Fixed after creation: switching the benefit shape would change what every
  // already-issued voucher's snapshot means, so the edit form shows it
  // read-only and the PATCH route does not send it.
  const [voucherType, setVoucherType] = useState<"fixed_off" | "percent_off">(
    initial?.voucherType ?? "fixed_off",
  );
  const isPercent = voucherType === "percent_off";
  const [discountKes, setDiscountKes] = useState(initial ? String(initial.discountKes) : "500");
  const [discountPercent, setDiscountPercent] = useState(
    initial?.discountPercent != null ? String(initial.discountPercent) : "10",
  );
  const [maximumDiscountKes, setMaximumDiscountKes] = useState(
    initial?.maximumDiscountKes != null ? String(initial.maximumDiscountKes) : "200",
  );
  const [minimumSpendKes, setMinimumSpendKes] = useState(initial ? String(initial.minimumSpendKes) : "1500");
  const [quantityCap, setQuantityCap] = useState(initial ? String(initial.quantityCap) : "10");
  const [authorizedBudgetKes, setAuthorizedBudgetKes] = useState(
    initial ? String(initial.authorizedBudgetKes) : "",
  );
  const [claimStartsAt, setClaimStartsAt] = useState(initial?.claimStartsAt.slice(0, 16) ?? "");
  const [claimEndsAt, setClaimEndsAt] = useState(initial?.claimEndsAt.slice(0, 16) ?? "");
  const [voucherValidityDays, setVoucherValidityDays] = useState(
    initial ? String(initial.voucherValidityDays) : "14",
  );
  const [distributionModes, setDistributionModes] = useState<string[]>(
    initial?.distributionModes ?? ["self_claim"],
  );
  const [recycleExpiredInventory, setRecycleExpiredInventory] = useState(initial?.recycleExpiredInventory ?? false);
  const savedRules = initial?.eligibilityRules ?? [];
  const savedRule = (type: string) => savedRules.find((rule) => rule.type === type);
  const [selectedRules, setSelectedRules] = useState<Record<string, boolean>>(() => ({
    ...(isEdit
      ? Object.fromEntries(savedRules.map((rule) => [String(rule.type), true]))
      : { pass_activated: true }),
    country_in: true,
    profile_country_set: true,
  }));
  const [minAccountAgeDays, setMinAccountAgeDays] = useState(String(savedRule("minimum_account_age_days")?.days ?? 7));
  const [verifiedActivityKey, setVerifiedActivityKey] = useState(String(savedRule("verified_activity_completed")?.templateKey ?? VERIFIED_ACTIVITY_TEMPLATE_KEYS[0]));
  const [cooldownDays, setCooldownDays] = useState(String(savedRule("fund_claim_cooldown")?.days ?? 30));
  const [claimDays, setClaimDays] = useState<number[]>(() => {
    const days = savedRule("claim_day_of_week")?.days;
    return Array.isArray(days) ? days as number[] : [...WEEKEND_DAYS];
  });
  const claimTimezone = String(savedRule("claim_day_of_week")?.timezone ?? CLAIM_DAY_TIMEZONE);
  const [customerCopy, setCustomerCopy] = useState(initial?.eligibilityCustomerCopy ?? "");
  // Never silently discard a legacy rule or change an ANY policy to ALL.
  const unsupportedSavedPolicy = isEdit && (
    (initial?.eligibilityMode != null && initial.eligibilityMode !== "all") ||
    savedRules.some((rule) => !isValidEligibilityRule(rule)) ||
    new Set(savedRules.map((rule) => rule.type)).size !== savedRules.length
  );
  const [restrictRedemption, setRestrictRedemption] = useState(Boolean(initial?.redemptionSchedule));
  const [redemptionDays, setRedemptionDays] = useState<number[]>(initial?.redemptionSchedule?.days ?? [...WEEKEND_DAYS]);
  const redemptionTimezone = initial?.redemptionSchedule?.timezone ?? CLAIM_DAY_TIMEZONE;
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The commitment floor is quantity × the WORST CASE per voucher. For a
  // percentage benefit that worst case is the cap, not the expected discount —
  // the fund reserves the ceiling at claim time and releases the unused part
  // when the till reports the real basket.
  const perVoucherCeiling = isPercent ? Number(maximumDiscountKes || 0) : Number(discountKes || 0);
  const floorBudget = Number(quantityCap || 0) * perVoucherCeiling;

  const filteredMerchants = useMemo(() => {
    const q = merchantFilter.trim().toLowerCase();
    if (!q) return merchants;
    return merchants.filter(
      (m) => m.name.toLowerCase().includes(q) || m.country?.toLowerCase().includes(q),
    );
  }, [merchants, merchantFilter]);

  function toggleMode(mode: string) {
    setDistributionModes((prev) => (prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode]));
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
      rules.push({ type: "minimum_account_age_days", days: Number(minAccountAgeDays) });
    }
    if (selectedRules.verified_activity_completed) {
      rules.push({ type: "verified_activity_completed", templateKey: verifiedActivityKey });
    }
    if (selectedRules.first_funded_voucher) rules.push({ type: "first_funded_voucher" });
    if (selectedRules.no_prior_merchant_redemption) rules.push({ type: "no_prior_merchant_redemption" });
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
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day],
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
    if (restrictRedemption && redemptionDays.length === 0) {
      setError("Select at least one day on which this voucher can be redeemed.");
      return;
    }
    if (unsupportedSavedPolicy) {
      setError("This allocation has a legacy or unsupported eligibility policy. It must be reviewed before editing; no saved rules have been changed.");
      return;
    }

    if (selectedRules.fund_claim_cooldown && !isValidBoundedDays(cooldownDays, 365)) {
      setError("Cooldown must be a whole number of days between 1 and 365.");
      return;
    }
    if (selectedRules.minimum_account_age_days && !isValidBoundedDays(minAccountAgeDays, 3650)) {
      setError("Minimum account age must be a whole number of days between 1 and 3650.");
      return;
    }
    if (selectedRules.claim_day_of_week && claimDays.length === 0) {
      setError("Select at least one day of the week the voucher can be claimed on.");
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

    setBusy(true);

    let eligibilityRuleSetId: string | undefined;
    const rules = buildRules();
    if (rules.length > 0) {
      const ruleRes = await fetch(`/api/admin/voucher-funds/${fundId}/eligibility-rule-sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "all", rules, customerCopy }),
      });
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
      redemptionSchedule: restrictRedemption ? { days: [...redemptionDays].sort((a, b) => a - b), timezone: redemptionTimezone } : null,
      discountKes: isPercent ? undefined : Number(discountKes),
      discountPercent: isPercent ? Number(discountPercent) : undefined,
      maximumDiscountKes: isPercent ? Number(maximumDiscountKes) : undefined,
      minimumSpendKes: Number(minimumSpendKes),
      quantityCap: Number(quantityCap),
      authorizedBudgetKes: authorizedBudgetKes ? Number(authorizedBudgetKes) : undefined,
      claimStartsAt: new Date(claimStartsAt).toISOString(),
      claimEndsAt: new Date(claimEndsAt).toISOString(),
      voucherValidityDays: Number(voucherValidityDays),
      distributionModes,
      recycleExpiredInventory,
      eligibilityRuleSetId,
      notes,
    };

    let res;
    if (isEdit) {
      body.expectedVersion = initial!.version;
      res = await fetch(`/api/admin/voucher-allocations/${initial!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      body.merchantId = merchantId;
      body.voucherType = voucherType;
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
    router.push(`/vouchers/funds/${fundId}/allocations/${result.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-6 p-6">
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {!isEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Merchant</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input placeholder="Search merchants by name or country" value={merchantFilter} onChange={(e) => setMerchantFilter(e.target.value)} />
            <select
              required
              value={merchantId}
              onChange={(e) => setMerchantId(e.target.value)}
              aria-label="Merchant"
              className="flex h-9 w-full rounded-card border border-border bg-surface px-3 text-sm text-ink shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Select a merchant…</option>
              {filteredMerchants.map((m) => (
                <option key={m.id} value={m.id} disabled={m.status !== "active"}>
                  {m.name} · {m.country ?? "—"} {m.status !== "active" ? `(${m.status})` : ""}
                </option>
              ))}
            </select>
          </CardContent>
        </Card>
      )}
      {isEdit && (
        <p className="text-sm text-ink-muted">
          Merchant: <span className="font-medium text-ink">{initial!.merchantName}</span> (fixed after creation)
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Benefit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Customer-facing title">
            <Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="KES 500 off your next purchase" />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="flex w-full rounded-card border border-border bg-surface px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </Field>
          <fieldset>
            <legend className="mb-1.5 block text-sm font-medium text-ink">Benefit type</legend>
            {isEdit ? (
              <p className="text-sm text-ink-muted">
                {isPercent ? "Percentage off" : "Flat KES off"}{" "}
                <span className="text-ink-muted">(fixed after creation)</span>
              </p>
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:gap-4">
                {(
                  [
                    ["fixed_off", "Flat KES off"],
                    ["percent_off", "Percentage off"],
                  ] as const
                ).map(([value, label]) => (
                  <label key={value} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="radio"
                      name="voucherType"
                      value={value}
                      checked={voucherType === value}
                      onChange={() => setVoucherType(value)}
                      className="h-4 w-4 accent-primary"
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          {isPercent ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Discount (%)">
                  <Input
                    required
                    type="number"
                    min="1"
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
                    min="1"
                    step="0.01"
                    value={maximumDiscountKes}
                    onChange={(e) => setMaximumDiscountKes(e.target.value)}
                  />
                </Field>
                <Field label="Quantity">
                  <Input required type="number" min="1" step="1" value={quantityCap} onChange={(e) => setQuantityCap(e.target.value)} />
                </Field>
              </div>
              <Field label="Minimum purchase (KES)">
                <Input required type="number" min="1" step="0.01" value={minimumSpendKes} onChange={(e) => setMinimumSpendKes(e.target.value)} />
              </Field>
              <p className="rounded-card border border-border bg-slate-50 px-3 py-2 text-sm text-ink">
                Akiba reimburses the discount the till actually applies, up to{" "}
                <strong>KES {Number(maximumDiscountKes || 0).toLocaleString()}</strong> per voucher —
                the cap binds at a basket of{" "}
                <strong>
                  KES{" "}
                  {Number(discountPercent) > 0
                    ? Math.round(
                        (Number(maximumDiscountKes || 0) * 100) / Number(discountPercent),
                      ).toLocaleString()
                    : "—"}
                </strong>
                . The budget floor below reserves the cap for every voucher, so actual spend is
                usually lower. Minimum purchase must exceed the cap.
              </p>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Discount (KES)">
                <Input required type="number" min="1" step="0.01" value={discountKes} onChange={(e) => setDiscountKes(e.target.value)} />
              </Field>
              <Field label="Minimum purchase (KES)">
                <Input required type="number" min="1" step="0.01" value={minimumSpendKes} onChange={(e) => setMinimumSpendKes(e.target.value)} />
              </Field>
              <Field label="Quantity">
                <Input required type="number" min="1" step="1" value={quantityCap} onChange={(e) => setQuantityCap(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label={`Authorized budget (KES) — floor is ${floorBudget.toLocaleString()}`}>
            <Input
              type="number"
              min={floorBudget || 0}
              step="0.01"
              placeholder={String(floorBudget)}
              value={authorizedBudgetKes}
              onChange={(e) => setAuthorizedBudgetKes(e.target.value)}
            />
          </Field>
          <Field label="Terms">
            <textarea
              value={termsText}
              onChange={(e) => setTermsText(e.target.value)}
              rows={2}
              className="flex w-full rounded-card border border-border bg-surface px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
          <CardHeader>
            <CardTitle>Eligibility to claim</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-card border border-teal-100 bg-teal-50 px-3 py-2 text-sm text-teal-900">
              Members must match <strong>all</strong> selected rules. Country is locked to the fund ({fundCountryCode}).
            </div>
            <div className="rounded-card border border-border bg-slate-50 px-3 py-2 text-sm text-ink">
              <strong>Required:</strong> Member profile country must be {fundCountryCode}. This is a system
              invariant enforced by the database on every claim — it cannot be removed or overridden here.
            </div>
            {/* not_blocked has no restriction source behind it yet and can
                never be created for a new allocation (runtime-hardening-spec.md
                §4.3) — it stays in ELIGIBILITY_RULE_TYPES only so a
                historical allocation that already references it still has a
                label to render elsewhere; it is never offered here. */}
            {ELIGIBILITY_RULE_TYPES.filter((type) => type !== "not_blocked").map((type) => (
              <RuleRow
                key={type}
                type={type}
                checked={type === "profile_country_set" ? true : Boolean(selectedRules[type])}
                onToggle={() => toggleRule(type)}
                disabled={type === "country_in" || type === "profile_country_set"}
              >
                {type === "country_in" && (
                  <Input
                    className="mt-2 max-w-xs"
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
                    value={minAccountAgeDays}
                    onChange={(e) => setMinAccountAgeDays(e.target.value)}
                  />
                )}
                {type === "verified_activity_completed" && (
                  <select
                    value={verifiedActivityKey}
                    onChange={(e) => setVerifiedActivityKey(e.target.value)}
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
                    value={cooldownDays}
                    onChange={(e) => setCooldownDays(e.target.value)}
                  />
                )}
                {type === "claim_day_of_week" && (
                  <fieldset className="mt-2">
                    <legend className="sr-only">Days the voucher can be claimed</legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {WEEKDAY_LABELS.map((label, day) => (
                        <label key={label} className="flex items-center gap-1.5 text-sm text-ink">
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
                      Evaluated in {claimTimezone}. These days restrict when members can claim; they do not restrict when a voucher can be redeemed.
                    </p>
                  </fieldset>
                )}
              </RuleRow>
            ))}
            <Field label="Customer-facing eligibility summary">
              <Input value={customerCopy} onChange={(e) => setCustomerCopy(e.target.value)} placeholder="Available to Kenya members who activated their Akiba Pass…" />
            </Field>
          </CardContent>
        </Card>

      <Card>
        <CardHeader><CardTitle>Redemption schedule</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={restrictRedemption} onChange={(event) => setRestrictRedemption(event.target.checked)} />
            Restrict which days the voucher can be used
          </label>
          {restrictRedemption && (
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Allowed redemption days</legend>
              <div className="flex flex-wrap gap-3">
                {WEEKDAY_LABELS.map((label, day) => (
                  <label key={label} className="flex min-h-11 items-center gap-2 text-sm">
                    <input type="checkbox" checked={redemptionDays.includes(day)} onChange={() => setRedemptionDays((days) => days.includes(day) ? days.filter((value) => value !== day) : [...days, day])} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <p className="text-sm text-ink-muted">
            {restrictRedemption ? `Enforced at merchant checkout in ${redemptionTimezone}.` : "Vouchers can be used on any day while valid."} To allow claims now and use only on weekends, select Sat and Sun here and leave the claim-day eligibility rule unselected.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Distribution &amp; schedule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            {DISTRIBUTION_MODES.map((mode) => (
              <label key={mode} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={distributionModes.includes(mode)} onChange={() => toggleMode(mode)} disabled={mode === "auto_award"} />
                {DISTRIBUTION_MODE_LABELS[mode]}
              </label>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Claim window starts">
              <Input required type="datetime-local" value={claimStartsAt} onChange={(e) => setClaimStartsAt(e.target.value)} />
            </Field>
            <Field label="Claim window ends">
              <Input required type="datetime-local" value={claimEndsAt} onChange={(e) => setClaimEndsAt(e.target.value)} />
            </Field>
          </div>
          <Field label="Voucher validity after claim (days)">
            <Input required type="number" min="1" value={voucherValidityDays} onChange={(e) => setVoucherValidityDays(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={recycleExpiredInventory} onChange={(e) => setRecycleExpiredInventory(e.target.checked)} />
            Recycle expired quantity back into available inventory
          </label>
          <Field label="Internal notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="flex w-full rounded-card border border-border bg-surface px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </Field>
        </CardContent>
      </Card>

      <Button type="submit" disabled={busy}>
        {isEdit ? "Save changes" : "Create draft allocation"}
      </Button>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
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
        <input type="checkbox" checked={checked} onChange={onToggle} disabled={disabled} />
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
