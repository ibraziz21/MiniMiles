"use client";

import { useState, useEffect, FormEvent } from "react";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PartnerSettings } from "@/types";

const COMMON_CITIES = ["Nairobi", "Mombasa", "Kisumu", "Nakuru", "Eldoret", "Thika", "Nyeri", "Meru", "Kericho", "Garissa"];

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
