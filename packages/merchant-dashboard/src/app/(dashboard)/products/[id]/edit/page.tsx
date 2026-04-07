"use client";

import { useState, useEffect, FormEvent } from "react";
import { useRouter, useParams } from "next/navigation";
import { TopBar } from "@/components/layout/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PRODUCT_CATEGORIES } from "@/types";

export default function EditProductPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    price_cusd: "",
    category: "general",
    image_url: "",
    active: true,
  });

  useEffect(() => {
    fetch(`/api/merchant/products/${id}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.product) {
          const p = data.product;
          setForm({
            name: p.name ?? "",
            description: p.description ?? "",
            price_cusd: String(p.price_cusd ?? ""),
            category: p.category ?? "general",
            image_url: p.image_url ?? "",
            active: p.active ?? true,
          });
        }
      })
      .finally(() => setFetching(false));
  }, [id]);

  function set(key: string, value: unknown) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/merchant/products/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          price_cusd: parseFloat(form.price_cusd),
          image_url: form.image_url || null,
          description: form.description || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to update product"); return; }
      router.push("/products");
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleArchive() {
    if (!confirm("Archive this product? It will be hidden from customers.")) return;
    await fetch(`/api/merchant/products/${id}`, { method: "DELETE" });
    router.push("/products");
  }

  if (fetching) return <div className="flex-1 flex items-center justify-center text-sm text-gray-500">Loading…</div>;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TopBar title="Edit Product" subtitle="Update product details" />
      <div className="flex-1 overflow-y-auto p-6">
        <Card className="max-w-lg">
          <CardHeader><CardTitle>Product details</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Name *</label>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Description</label>
                <textarea
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring min-h-[80px] resize-none"
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Price (cUSD) *</label>
                <Input type="number" step="0.01" min="0.01" value={form.price_cusd} onChange={(e) => set("price_cusd", e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Category</label>
                <select
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value)}
                >
                  {PRODUCT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-gray-700">Image URL</label>
                <Input
                  value={form.image_url}
                  onChange={(e) => set("image_url", e.target.value)}
                  placeholder="https://images.unsplash.com/photo-1511707171634-5f897ff02aa9"
                />
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="active" checked={form.active} onChange={(e) => set("active", e.target.checked)} className="h-4 w-4 rounded border-gray-300 text-[#238D9D]" />
                <label htmlFor="active" className="text-sm font-medium text-gray-700">Active</label>
              </div>
              {error && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
              <div className="flex gap-3">
                <Button type="submit" disabled={loading}>{loading ? "Saving…" : "Save Changes"}</Button>
                <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
                <Button type="button" variant="destructive" onClick={handleArchive} className="ml-auto">Archive</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
