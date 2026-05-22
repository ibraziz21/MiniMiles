"use client";

import { FormEvent, useState } from "react";
import { Save, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminSettings, PayoutMethod } from "@/lib/adminSettings";

const PAYOUT_METHODS: Array<{ value: PayoutMethod; label: string }> = [
  { value: "wallet", label: "Wallet" },
  { value: "bank", label: "Bank" },
  { value: "mpesa", label: "M-Pesa" },
];

interface SystemSettingsFormProps {
  settings: AdminSettings;
  canEdit: boolean;
}

export function SystemSettingsForm({ settings: initialSettings, canEdit }: SystemSettingsFormProps) {
  const [settings, setSettings] = useState<AdminSettings>(initialSettings);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function updateSecurity<K extends keyof AdminSettings["security"]>(
    key: K,
    value: AdminSettings["security"][K],
  ) {
    setSettings((current) => ({
      ...current,
      security: { ...current.security, [key]: value },
    }));
  }

  function updateFinance<K extends keyof AdminSettings["finance"]>(
    key: K,
    value: AdminSettings["finance"][K],
  ) {
    setSettings((current) => ({
      ...current,
      finance: { ...current.finance, [key]: value },
    }));
  }

  function updateNotifications<K extends keyof AdminSettings["notifications"]>(
    key: K,
    value: AdminSettings["notifications"][K],
  ) {
    setSettings((current) => ({
      ...current,
      notifications: { ...current.notifications, [key]: value },
    }));
  }

  function togglePayoutMethod(method: PayoutMethod) {
    const exists = settings.finance.enabledPayoutMethods.includes(method);
    const next = exists
      ? settings.finance.enabledPayoutMethods.filter((item) => item !== method)
      : [...settings.finance.enabledPayoutMethods, method];

    updateFinance("enabledPayoutMethods", next.length > 0 ? next : [method]);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    try {
      const res = await fetch("/api/admin/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to save settings");
        return;
      }
      setSettings(data.settings);
      setSuccess(true);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-[#238D9D]" />
          <h3 className="text-sm font-semibold text-slate-900">Security Policy</h3>
        </div>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <NumberField
            label="Password minimum"
            value={settings.security.passwordMinLength}
            min={10}
            max={128}
            disabled={!canEdit || loading}
            onChange={(value) => updateSecurity("passwordMinLength", value)}
          />
          <NumberField
            label="Session timeout minutes"
            value={settings.security.sessionTimeoutMinutes}
            min={15}
            max={1440}
            disabled={!canEdit || loading}
            onChange={(value) => updateSecurity("sessionTimeoutMinutes", value)}
          />
          <NumberField
            label="Failed login limit"
            value={settings.security.loginLockoutMaxFailures}
            min={3}
            max={20}
            disabled={!canEdit || loading}
            onChange={(value) => updateSecurity("loginLockoutMaxFailures", value)}
          />
          <NumberField
            label="Lockout minutes"
            value={settings.security.loginLockoutMinutes}
            min={5}
            max={1440}
            disabled={!canEdit || loading}
            onChange={(value) => updateSecurity("loginLockoutMinutes", value)}
          />
        </div>
        <Checkbox
          label="Require new admins to change temporary password"
          checked={settings.security.requireTempPasswordReset}
          disabled={!canEdit || loading}
          onChange={(checked) => updateSecurity("requireTempPasswordReset", checked)}
        />
      </section>

      <section className="space-y-3 border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">Finance Defaults</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <TextField
            label="Receipt prefix"
            value={settings.finance.receiptPrefix}
            disabled={!canEdit || loading}
            onChange={(value) => updateFinance("receiptPrefix", value)}
          />
          <NumberField
            label="Approval threshold"
            value={settings.finance.payoutApprovalThreshold}
            min={0}
            max={100000000}
            step="0.01"
            disabled={!canEdit || loading}
            onChange={(value) => updateFinance("payoutApprovalThreshold", value)}
          />
          <TextField
            label="Business name"
            value={settings.finance.businessName}
            disabled={!canEdit || loading}
            onChange={(value) => updateFinance("businessName", value)}
          />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <TextField
            label="Business email"
            type="email"
            value={settings.finance.businessEmail}
            disabled={!canEdit || loading}
            onChange={(value) => updateFinance("businessEmail", value)}
          />
          <TextField
            label="Business phone"
            value={settings.finance.businessPhone}
            disabled={!canEdit || loading}
            onChange={(value) => updateFinance("businessPhone", value)}
          />
          <label className="block space-y-1.5 md:col-span-1">
            <span className="text-xs font-medium text-slate-600">Business address</span>
            <textarea
              value={settings.finance.businessAddress}
              onChange={(e) => updateFinance("businessAddress", e.target.value)}
              disabled={!canEdit || loading}
              className="min-h-9 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#238D9D] disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-600">Enabled payout methods</p>
          <div className="flex flex-wrap gap-3">
            {PAYOUT_METHODS.map((method) => (
              <Checkbox
                key={method.value}
                label={method.label}
                checked={settings.finance.enabledPayoutMethods.includes(method.value)}
                disabled={!canEdit || loading}
                onChange={() => togglePayoutMethod(method.value)}
              />
            ))}
          </div>
        </div>
        <Checkbox
          label="Require transaction hash for wallet payouts"
          checked={settings.finance.requireTxHashForWallet}
          disabled={!canEdit || loading}
          onChange={(checked) => updateFinance("requireTxHashForWallet", checked)}
        />
      </section>

      <section className="space-y-3 border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">Notifications</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <TextField
            label="Finance alert email"
            type="email"
            value={settings.notifications.financeAlertEmail}
            disabled={!canEdit || loading}
            onChange={(value) => updateNotifications("financeAlertEmail", value)}
          />
          <TextField
            label="Ops alert email"
            type="email"
            value={settings.notifications.opsAlertEmail}
            disabled={!canEdit || loading}
            onChange={(value) => updateNotifications("opsAlertEmail", value)}
          />
          <TextField
            label="Support email"
            type="email"
            value={settings.notifications.supportEmail}
            disabled={!canEdit || loading}
            onChange={(value) => updateNotifications("supportEmail", value)}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
        <Button type="submit" disabled={!canEdit || loading}>
          <Save className="h-4 w-4" />
          {loading ? "Saving..." : "Save settings"}
        </Button>
        {!canEdit && <p className="text-xs text-slate-500">Only super admins can update system settings.</p>}
        {error && <p className="text-xs text-red-600">{error}</p>}
        {success && <p className="text-xs text-emerald-600">Settings saved.</p>}
      </div>
    </form>
  );
}

function TextField({
  label,
  value,
  disabled,
  type = "text",
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  type?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <Input
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step = "1",
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <Input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Checkbox({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-slate-300 text-[#238D9D] focus:ring-[#238D9D]"
      />
      {label}
    </label>
  );
}
