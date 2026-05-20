"use client";

import { useState, useEffect, FormEvent } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PartnerSettings } from "@/types";

const COMMON_CITIES = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Nyeri", "Meru", "Kericho", "Garissa"];
const PAYOUT_DESTINATIONS: Array<{ value: PartnerSettings["payout_destination_type"]; label: string; description: string }> = [
  { value: "wallet", label: "Wallet", description: "Celo wallet payout" },
  { value: "bank", label: "Bank", description: "Bank transfer" },
  { value: "mpesa", label: "M-Pesa", description: "Mobile money" },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState<PartnerSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    // Fetch settings
    fetch("/api/merchant/settings")
      .then((r) => r.json())
      .then((d) => { if (d.settings) setSettings(d.settings); })
      .finally(() => setFetching(false));

    // Fetch session to check role
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => { if (d.merchant?.role === "owner") setIsOwner(true); });
  }, []);

  function toggleCity(city: string) {
    if (!settings) return;
    const cities = settings.delivery_cities ?? [];
    const next = cities.includes(city)
      ? cities.filter((c) => c !== city)
      : [...cities, city];
    setSettings({ ...settings, delivery_cities: next });
  }

  function update(key: keyof PartnerSettings, value: unknown) {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!settings || !isOwner) return;
    setError(null);
    setLoading(true);
    setSaved(false);

    try {
      const res = await fetch("/api/merchant/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_active: settings.store_active,
          logo_url: settings.logo_url || null,
          support_email: settings.support_email || null,
          support_phone: settings.support_phone || null,
          delivery_cities: settings.delivery_cities,
          notify_new_order: settings.notify_new_order,
          notify_stale_order: settings.notify_stale_order,
          stale_threshold_hours: settings.stale_threshold_hours,
          payout_destination_type: settings.payout_destination_type ?? "wallet",
          payout_wallet: settings.payout_wallet || null,
          payout_bank_name: settings.payout_bank_name || null,
          payout_bank_branch: settings.payout_bank_branch || null,
          payout_bank_account_name: settings.payout_bank_account_name || null,
          payout_bank_account_number: settings.payout_bank_account_number || null,
          payout_mpesa_name: settings.payout_mpesa_name || null,
          payout_mpesa_phone: settings.payout_mpesa_phone || null,
          payout_notes: settings.payout_notes || null,
          kes_exchange_rate: settings.kes_exchange_rate ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to save"); return; }
      setSettings(data.settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  if (fetching) return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Settings" subtitle="Store configuration" />
      <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Loading…</div>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Settings" subtitle="Store configuration and notifications" />
      <div className="flex-1 overflow-y-auto p-6">
        {!isOwner && (
          <div className="mb-4 rounded-lg bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            Only store owners can modify settings.
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
          {/* Store status */}
          <Card>
            <CardHeader><CardTitle>Store</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Store Active</p>
                  <p className="text-xs text-gray-500">When off, new orders cannot be placed</p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={settings?.store_active ?? true}
                    onChange={(e) => update("store_active", e.target.checked)}
                    disabled={!isOwner}
                  />
                  <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#238D9D] peer-checked:after:translate-x-full peer-checked:after:border-white" />
                </label>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Logo URL</label>
                <Input value={settings?.logo_url ?? ""} onChange={(e) => update("logo_url", e.target.value)} placeholder="https://..." disabled={!isOwner} />
              </div>
            </CardContent>
          </Card>

          {/* Support contact */}
          <Card>
            <CardHeader><CardTitle>Support Contact</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Support Email</label>
                <Input type="email" value={settings?.support_email ?? ""} onChange={(e) => update("support_email", e.target.value)} placeholder="support@merchant.com" disabled={!isOwner} />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Support Phone</label>
                <Input value={settings?.support_phone ?? ""} onChange={(e) => update("support_phone", e.target.value)} placeholder="+254..." disabled={!isOwner} />
              </div>
            </CardContent>
          </Card>

          {/* Delivery coverage */}
          <Card>
            <CardHeader><CardTitle>Delivery Coverage</CardTitle></CardHeader>
            <CardContent>
              <p className="text-xs text-gray-500 mb-3">Select cities where you deliver.</p>
              <div className="flex flex-wrap gap-2">
                {COMMON_CITIES.map((city) => {
                  const active = (settings?.delivery_cities ?? []).includes(city);
                  return (
                    <button
                      key={city}
                      type="button"
                      disabled={!isOwner}
                      onClick={() => toggleCity(city)}
                      className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                        active
                          ? "bg-[#238D9D] text-white border-[#238D9D]"
                          : "bg-white text-gray-600 border-gray-200 hover:border-[#238D9D]"
                      } disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      {city}
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card>
            <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">New Order Emails</p>
                  <p className="text-xs text-gray-500">Email all team members when a new order arrives</p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input type="checkbox" className="sr-only peer" checked={settings?.notify_new_order ?? true} onChange={(e) => update("notify_new_order", e.target.checked)} disabled={!isOwner} />
                  <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#238D9D] peer-checked:after:translate-x-full peer-checked:after:border-white" />
                </label>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">Stale Order Reminders</p>
                  <p className="text-xs text-gray-500">Get notified when orders sit unattended too long</p>
                </div>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input type="checkbox" className="sr-only peer" checked={settings?.notify_stale_order ?? true} onChange={(e) => update("notify_stale_order", e.target.checked)} disabled={!isOwner} />
                  <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-[#238D9D] peer-checked:after:translate-x-full peer-checked:after:border-white" />
                </label>
              </div>
              {settings?.notify_stale_order && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Stale Threshold (hours)</label>
                  <Input
                    type="number"
                    min="1"
                    max="72"
                    value={String(settings?.stale_threshold_hours ?? 2)}
                    onChange={(e) => update("stale_threshold_hours", parseInt(e.target.value))}
                    disabled={!isOwner}
                    className="max-w-[120px]"
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payout details */}
          <Card>
            <CardHeader><CardTitle>Payout Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Payout Destination</label>
                <div className="grid gap-2 sm:grid-cols-3">
                  {PAYOUT_DESTINATIONS.map((item) => {
                    const active = (settings?.payout_destination_type ?? "wallet") === item.value;
                    return (
                      <button
                        key={item.value}
                        type="button"
                        disabled={!isOwner}
                        onClick={() => update("payout_destination_type", item.value)}
                        className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                          active
                            ? "border-[#238D9D] bg-[#238D9D0D] text-[#238D9D]"
                            : "border-gray-200 bg-white text-gray-600 hover:border-[#238D9D66]"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <span className="block text-sm font-semibold">{item.label}</span>
                        <span className="block text-xs opacity-75">{item.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {(settings?.payout_destination_type ?? "wallet") === "wallet" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Payout Wallet Address</label>
                  <Input
                    value={settings?.payout_wallet ?? ""}
                    onChange={(e) => update("payout_wallet", e.target.value || null)}
                    placeholder="0x..."
                    disabled={!isOwner}
                  />
                  <p className="text-xs text-gray-400">EVM address on Celo that receives payouts from AkibaMiles.</p>
                </div>
              )}

              {(settings?.payout_destination_type ?? "wallet") === "bank" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Bank Name</label>
                    <Input value={settings?.payout_bank_name ?? ""} onChange={(e) => update("payout_bank_name", e.target.value || null)} placeholder="KCB, Equity, ABSA..." disabled={!isOwner} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Branch</label>
                    <Input value={settings?.payout_bank_branch ?? ""} onChange={(e) => update("payout_bank_branch", e.target.value || null)} placeholder="Branch or code" disabled={!isOwner} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Account Name</label>
                    <Input value={settings?.payout_bank_account_name ?? ""} onChange={(e) => update("payout_bank_account_name", e.target.value || null)} placeholder="Registered account name" disabled={!isOwner} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Account Number</label>
                    <Input value={settings?.payout_bank_account_number ?? ""} onChange={(e) => update("payout_bank_account_number", e.target.value || null)} placeholder="Account number" disabled={!isOwner} />
                  </div>
                </div>
              )}

              {(settings?.payout_destination_type ?? "wallet") === "mpesa" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">Recipient Name</label>
                    <Input value={settings?.payout_mpesa_name ?? ""} onChange={(e) => update("payout_mpesa_name", e.target.value || null)} placeholder="Registered M-Pesa name" disabled={!isOwner} />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-gray-700">M-Pesa Phone</label>
                    <Input value={settings?.payout_mpesa_phone ?? ""} onChange={(e) => update("payout_mpesa_phone", e.target.value || null)} placeholder="+2547..." disabled={!isOwner} />
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Payout Notes</label>
                <textarea
                  value={settings?.payout_notes ?? ""}
                  onChange={(e) => update("payout_notes", e.target.value || null)}
                  placeholder="Any extra finance instructions"
                  disabled={!isOwner}
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#238D9D] disabled:cursor-not-allowed disabled:opacity-50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">KES Exchange Rate</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="1"
                    max="10000"
                    step="0.01"
                    value={String(settings?.kes_exchange_rate ?? 130)}
                    onChange={(e) => update("kes_exchange_rate", e.target.value ? parseFloat(e.target.value) : null)}
                    disabled={!isOwner}
                    className="max-w-[140px]"
                  />
                  <span className="text-sm text-gray-500">KES per 1 USD</span>
                </div>
                <p className="text-xs text-gray-400">Used to display KES amounts on your billing page. Defaults to 130.</p>
              </div>
            </CardContent>
          </Card>

          {isOwner && (
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save Settings"}</Button>
              {saved && <span className="text-sm text-green-600">Saved!</span>}
              {error && <span className="text-sm text-red-600">{error}</span>}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
