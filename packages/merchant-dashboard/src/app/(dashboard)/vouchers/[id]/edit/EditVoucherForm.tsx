"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PRODUCT_CATEGORIES } from "@/types";
import type { MerchantProduct, VoucherTemplate } from "@/types";

type Props = {
  id: string;
  template: VoucherTemplate;
  products: MerchantProduct[];
};

export default function EditVoucherForm({ id, template: t, products }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialScope = t.linked_product_id ? "product" : t.applicable_category ? "category" : "all";

  const [form, setFormState] = useState({
    title:               t.title ?? "",
    voucher_type:        t.voucher_type ?? "percent_off",
    miles_cost:          String(t.miles_cost ?? 200),
    discount_percent:    t.discount_percent != null ? String(t.discount_percent) : "",
    discount_cusd:       t.discount_cusd    != null ? String(t.discount_cusd)    : "",
    scope:               initialScope as "all" | "category" | "product",
    applicable_category: t.applicable_category ?? "",
    linked_product_id:   t.linked_product_id ?? "",
    retail_value_cusd:   t.retail_value_cusd != null ? String(t.retail_value_cusd) : "",
    cooldown_seconds:    String(t.cooldown_seconds ?? 86400),
    global_cap:          t.global_cap != null ? String(t.global_cap) : "",
    expires_at:          t.expires_at ? t.expires_at.slice(0, 10) : "",
    active:              t.active ?? true,
  });

  function set(key: string, value: unknown) {
    setFormState((f) => ({ ...f, [key]: value }));
  }

  const selectedProduct = products.find((p) => p.id === form.linked_product_id) ?? null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload: Record<string, unknown> = {
        title:               form.title,
        voucher_type:        form.voucher_type,
        miles_cost:          parseInt(form.miles_cost),
        applicable_category: form.scope === "category" ? (form.applicable_category || null) : null,
        linked_product_id:   form.scope === "product"  ? (form.linked_product_id || null) : null,
        retail_value_cusd:   form.scope === "product" && form.retail_value_cusd
          ? parseFloat(form.retail_value_cusd)
          : null,
        cooldown_seconds:    parseInt(form.cooldown_seconds),
        global_cap:          form.global_cap ? parseInt(form.global_cap) : null,
        expires_at:          form.expires_at || null,
        active:              form.active,
      };
      if (form.voucher_type === "percent_off") payload.discount_percent = parseFloat(form.discount_percent);
      if (form.voucher_type === "fixed_off")   payload.discount_cusd    = parseFloat(form.discount_cusd);

      const res = await fetch(`/api/merchant/voucher-templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to update template"); return; }
      router.push("/vouchers");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivate() {
    if (!confirm("Deactivate this template? Users will no longer be able to issue this voucher.")) return;
    await fetch(`/api/merchant/voucher-templates/${id}`, { method: "DELETE" });
    router.push("/vouchers");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Title *</label>
        <Input value={form.title} onChange={(e) => set("title", e.target.value)} required />
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Voucher Type *</label>
        <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={form.voucher_type} onChange={(e) => set("voucher_type", e.target.value)}>
          <option value="percent_off">Percent Off</option>
          <option value="fixed_off">Fixed Discount (cUSD)</option>
          <option value="free">Free Item</option>
        </select>
      </div>

      {form.voucher_type === "percent_off" && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Discount Percent *</label>
          <Input type="number" min="1" max="100" value={form.discount_percent} onChange={(e) => set("discount_percent", e.target.value)} required />
        </div>
      )}
      {form.voucher_type === "fixed_off" && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Discount Amount (cUSD) *</label>
          <Input type="number" step="0.01" min="0.01" value={form.discount_cusd} onChange={(e) => set("discount_cusd", e.target.value)} required />
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Miles Cost *</label>
        <Input type="number" min="0" value={form.miles_cost} onChange={(e) => set("miles_cost", e.target.value)} required />
      </div>

      {/* Scope selector */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">Applies To</label>
        <div className="flex gap-2">
          {(["all", "category", "product"] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => set("scope", s)}
              className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                form.scope === s
                  ? "bg-[#238D9D] text-white border-[#238D9D]"
                  : "bg-white text-gray-600 border-gray-200 hover:border-[#238D9D]"
              }`}
            >
              {s === "all" ? "All products" : s === "category" ? "A category" : "Specific product"}
            </button>
          ))}
        </div>
      </div>

      {form.scope === "category" && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Category *</label>
          <select
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={form.applicable_category}
            onChange={(e) => set("applicable_category", e.target.value)}
            required
          >
            <option value="">Select a category…</option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
            ))}
          </select>
        </div>
      )}

      {form.scope === "product" && (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Product *</label>
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.linked_product_id}
              onChange={(e) => {
                const prod = products.find((p) => p.id === e.target.value);
                set("linked_product_id", e.target.value);
                if (prod) set("retail_value_cusd", String(prod.price_cusd));
              }}
              required
            >
              <option value="">
                {products.length === 0 ? "No products found — add products first" : "Select a product…"}
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — ${Number(p.price_cusd).toFixed(2)}{!p.active ? " (inactive)" : ""}
                </option>
              ))}
            </select>
            {selectedProduct && (
              <p className="text-xs text-gray-400">
                Category: {selectedProduct.category ?? "—"} · Price: ${Number(selectedProduct.price_cusd).toFixed(2)} cUSD
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-gray-700">Retail Value (cUSD)</label>
            <Input
              type="number"
              step="0.01"
              min="0.01"
              value={form.retail_value_cusd}
              onChange={(e) => set("retail_value_cusd", e.target.value)}
              placeholder="Pre-filled from product price"
            />
            <p className="text-xs text-gray-400">
              For "Free Item" vouchers this is the value covered.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-gray-700">Cooldown (seconds)</label>
          <Input type="number" min="0" value={form.cooldown_seconds} onChange={(e) => set("cooldown_seconds", e.target.value)} />
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
        <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save Changes"}</Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
        <Button type="button" variant="destructive" onClick={handleDeactivate} className="ml-auto">Deactivate</Button>
      </div>
    </form>
  );
}
