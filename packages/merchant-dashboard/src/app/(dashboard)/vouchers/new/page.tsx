"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRODUCT_CATEGORIES } from "@/types";

export default function NewVoucherTemplatePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    voucher_type: "percent_off",
    miles_cost: "200",
    discount_percent: "",
    discount_cusd: "",
    applicable_category: "",
    cooldown_seconds: "86400",
    global_cap: "",
    expires_at: "",
    active: true,
  });

  function set(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload: Record<string, unknown> = {
        title: form.title,
        voucher_type: form.voucher_type,
        miles_cost: parseInt(form.miles_cost),
        applicable_category: form.applicable_category || null,
        cooldown_seconds: parseInt(form.cooldown_seconds),
        global_cap: form.global_cap ? parseInt(form.global_cap) : null,
        expires_at: form.expires_at || null,
        active: form.active,
      };
      if (form.voucher_type === "percent_off") payload.discount_percent = parseFloat(form.discount_percent);
      if (form.voucher_type === "fixed_off") payload.discount_cusd = parseFloat(form.discount_cusd);

      const res = await fetch("/api/merchant/voucher-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to create template"); return; }
      router.push("/vouchers");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="New Voucher Template" subtitle="Define a redeemable voucher" />
      <div className="flex-1 overflow-y-auto p-6">
        <Card className="max-w-lg">
          <CardHeader><CardTitle>Template details</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Title *</label>
                <Input value={form.title} onChange={(e) => set("title", e.target.value)} required placeholder="e.g. 10% off electronics" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Voucher Type *</label>
                <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={form.voucher_type} onChange={(e) => set("voucher_type", e.target.value)}>
                  <option value="percent_off">Percent Off</option>
                  <option value="fixed_off">Fixed Discount (cUSD)</option>
                  <option value="free">Free Item</option>
                </select>
              </div>
              {form.voucher_type === "percent_off" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Discount Percent *</label>
                  <Input type="number" min="1" max="100" value={form.discount_percent} onChange={(e) => set("discount_percent", e.target.value)} required placeholder="e.g. 10" />
                </div>
              )}
              {form.voucher_type === "fixed_off" && (
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Discount Amount (cUSD) *</label>
                  <Input type="number" step="0.01" min="0.01" value={form.discount_cusd} onChange={(e) => set("discount_cusd", e.target.value)} required placeholder="e.g. 5.00" />
                </div>
              )}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Miles Cost *</label>
                <Input type="number" min="0" value={form.miles_cost} onChange={(e) => set("miles_cost", e.target.value)} required placeholder="e.g. 200" />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Applicable Category</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.applicable_category}
                  onChange={(e) => set("applicable_category", e.target.value)}
                >
                  <option value="">All categories</option>
                  {PRODUCT_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Cooldown (seconds)</label>
                  <Input type="number" min="0" value={form.cooldown_seconds} onChange={(e) => set("cooldown_seconds", e.target.value)} placeholder="86400" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-gray-700">Global Cap</label>
                  <Input type="number" min="1" value={form.global_cap} onChange={(e) => set("global_cap", e.target.value)} placeholder="Unlimited" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Expiry Date</label>
                <Input type="date" value={form.expires_at} onChange={(e) => set("expires_at", e.target.value)} />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="active" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 rounded border-gray-300" />
                <label htmlFor="active" className="text-sm font-medium text-gray-700">Active</label>
              </div>
              {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
              <div className="flex gap-3">
                <Button type="submit" disabled={loading}>{loading ? "Creating…" : "Create Template"}</Button>
                <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
