"use client";

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
  DISTRIBUTION_MODES,
  DISTRIBUTION_MODE_LABELS,
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
  discountKes: number;
  minimumSpendKes: number;
  quantityCap: number;
  authorizedBudgetKes: number;
  claimStartsAt: string;
  claimEndsAt: string;
  voucherValidityDays: number;
  distributionModes: string[];
  recycleExpiredInventory: boolean;
}

// Merchant + benefit + eligibility + distribution + funding review, combined
// into one form since the allocation RPC accepts them together. See
// akiba-funded-voucher-admin-spec.md §7.2-§7.6.
export function AllocationForm({
  fundId,
  merchants,
  initial,
}: {
  fundId: string;
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
  const [discountKes, setDiscountKes] = useState(initial ? String(initial.discountKes) : "500");
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
  const [ruleMode, setRuleMode] = useState<"all" | "any">("all");
  const [selectedRules, setSelectedRules] = useState<Record<string, boolean>>({
    pass_activated: true,
    profile_country_set: true,
  });
  const [countryList, setCountryList] = useState("KE");
  const [minAccountAgeDays, setMinAccountAgeDays] = useState("0");
  const [verifiedActivityKey, setVerifiedActivityKey] = useState<string>(VERIFIED_ACTIVITY_TEMPLATE_KEYS[0]);
  const [cooldownDays, setCooldownDays] = useState("0");
  const [customerCopy, setCustomerCopy] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const floorBudget = Number(quantityCap || 0) * Number(discountKes || 0);

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
  function toggleRule(type: string) {
    setSelectedRules((prev) => ({ ...prev, [type]: !prev[type] }));
  }

  function buildRules() {
    const rules: Record<string, unknown>[] = [];
    if (selectedRules.country_in) {
      rules.push({ type: "country_in", countries: countryList.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean) });
    }
    if (selectedRules.pass_activated) rules.push({ type: "pass_activated" });
    if (selectedRules.profile_country_set) rules.push({ type: "profile_country_set" });
    if (selectedRules.minimum_account_age_days) {
      rules.push({ type: "minimum_account_age_days", days: Number(minAccountAgeDays) || 0 });
    }
    if (selectedRules.verified_activity_completed) {
      rules.push({ type: "verified_activity_completed", templateKey: verifiedActivityKey });
    }
    if (selectedRules.first_funded_voucher) rules.push({ type: "first_funded_voucher" });
    if (selectedRules.no_prior_merchant_redemption) rules.push({ type: "no_prior_merchant_redemption" });
    if (selectedRules.fund_claim_cooldown) {
      rules.push({ type: "fund_claim_cooldown", cooldownSeconds: (Number(cooldownDays) || 0) * 86400 });
    }
    if (selectedRules.not_blocked) rules.push({ type: "not_blocked" });
    return rules;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    let eligibilityRuleSetId: string | undefined;
    const rules = buildRules();
    if (rules.length > 0 && !isEdit) {
      const ruleRes = await fetch(`/api/admin/voucher-funds/${fundId}/eligibility-rule-sets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: ruleMode, rules, customerCopy }),
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
      discountKes: Number(discountKes),
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
              className="flex h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
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
        <p className="text-sm text-slate-500">
          Merchant: <span className="font-medium text-slate-900">{initial!.merchantName}</span> (fixed after creation)
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
              className="flex w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
            />
          </Field>
          <div className="grid grid-cols-3 gap-4">
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
              className="flex w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
            />
          </Field>
        </CardContent>
      </Card>

      {!isEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Eligibility</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <span>Member must match</span>
              <select value={ruleMode} onChange={(e) => setRuleMode(e.target.value as "all" | "any")} className="rounded border border-slate-200 px-2 py-1">
                <option value="all">all selected rules</option>
                <option value="any">any selected rule</option>
              </select>
            </div>
            {ELIGIBILITY_RULE_TYPES.map((type) => (
              <RuleRow key={type} type={type} checked={Boolean(selectedRules[type])} onToggle={() => toggleRule(type)}>
                {type === "country_in" && (
                  <Input
                    className="mt-2 max-w-xs"
                    value={countryList}
                    onChange={(e) => setCountryList(e.target.value)}
                    placeholder="KE, UG, TZ"
                  />
                )}
                {type === "minimum_account_age_days" && (
                  <Input
                    className="mt-2 max-w-[120px]"
                    type="number"
                    min="0"
                    value={minAccountAgeDays}
                    onChange={(e) => setMinAccountAgeDays(e.target.value)}
                  />
                )}
                {type === "verified_activity_completed" && (
                  <select
                    value={verifiedActivityKey}
                    onChange={(e) => setVerifiedActivityKey(e.target.value)}
                    className="mt-2 rounded border border-slate-200 px-2 py-1 text-sm"
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
                    min="0"
                    value={cooldownDays}
                    onChange={(e) => setCooldownDays(e.target.value)}
                  />
                )}
              </RuleRow>
            ))}
            <Field label="Customer-facing eligibility summary">
              <Input value={customerCopy} onChange={(e) => setCustomerCopy(e.target.value)} placeholder="Available to Kenya members who activated their Akiba Pass…" />
            </Field>
          </CardContent>
        </Card>
      )}

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
              className="flex w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
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
      <span className="text-xs font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

function RuleRow({
  type,
  checked,
  onToggle,
  children,
}: {
  type: EligibilityRuleType;
  checked: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const warning = ELIGIBILITY_RULE_WARNINGS[type];
  return (
    <div className="rounded-lg border border-slate-100 px-3 py-2">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={checked} onChange={onToggle} />
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
