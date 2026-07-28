"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertCircle } from "lucide-react";

type RecoverableOrder = {
  incident_id: string;
  item_name: string;
  price_cusd: number | null;
  recipient_name: string | null;
  phone: string | null;
  city: string | null;
  missing_fields: string[];
  created_at: string;
};

export function RecoveryBanner() {
  const router = useRouter();
  const [items, setItems] = useState<RecoverableOrder[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [form, setForm] = useState<{ recipient_name: string; phone: string; city: string }>({
    recipient_name: "", phone: "", city: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/shop/orders/recoverable")
      .then((r) => r.json())
      .then((data) => setItems(data.recoverable ?? []))
      .catch(() => setItems([]));
  }, []);

  async function finish(item: RecoverableOrder) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shop/orders/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          incident_id: item.incident_id,
          ...(item.missing_fields.includes("recipient_name") ? { recipient_name: form.recipient_name } : {}),
          ...(item.missing_fields.includes("phone") ? { phone: form.phone } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not finish this order — please try again.");
        return;
      }
      setItems((prev) => (prev ?? []).filter((i) => i.incident_id !== item.incident_id));
      setActive(null);
      router.refresh();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      {items.map((item) => {
        const needsForm = item.missing_fields.length > 0;
        const isActive = active === item.incident_id;
        return (
          <div key={item.incident_id} className="rounded-2xl border border-akiba-teal/30 bg-akiba-tint p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-akiba-teal" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-akiba-ink">Payment confirmed — finish your order</p>
                <p className="mt-0.5 text-sm text-akiba-muted">
                  {item.item_name}{item.price_cusd != null ? ` · $${item.price_cusd.toFixed(2)}` : ""}
                </p>

                {!isActive && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => {
                        if (needsForm) { setActive(item.incident_id); return; }
                        void finish(item);
                      }}
                      disabled={loading}
                      className="rounded-full bg-akiba-teal px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#1E7E8D] disabled:opacity-50"
                    >
                      {loading && active === null ? "Finishing…" : "Finish order"}
                    </button>
                  </div>
                )}

                {isActive && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs text-akiba-muted">We just need a couple of details to complete this order:</p>
                    {item.missing_fields.includes("recipient_name") && (
                      <input
                        placeholder="Recipient name"
                        value={form.recipient_name}
                        onChange={(e) => setForm((f) => ({ ...f, recipient_name: e.target.value }))}
                        className="w-full rounded-lg border border-akiba-line px-3 py-2 text-sm outline-none focus:border-akiba-teal"
                      />
                    )}
                    {item.missing_fields.includes("phone") && (
                      <input
                        placeholder="Phone number"
                        value={form.phone}
                        onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                        className="w-full rounded-lg border border-akiba-line px-3 py-2 text-sm outline-none focus:border-akiba-teal"
                      />
                    )}
                    {error && <p className="flex items-center gap-1.5 text-xs text-red-600"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setActive(null)}
                        disabled={loading}
                        className="rounded-full border border-akiba-line px-4 py-1.5 text-sm font-semibold text-akiba-muted"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void finish(item)}
                        disabled={loading}
                        className="flex-1 rounded-full bg-akiba-teal px-4 py-1.5 text-sm font-semibold text-white hover:bg-[#1E7E8D] disabled:opacity-50"
                      >
                        {loading ? "Finishing…" : "Finish order"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
