"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function OrphanedPaymentActions({ incidentId }: { incidentId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function refundInstead() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/incidents/${incidentId}/refund`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <div className="space-y-1 text-right">
        <button
          onClick={() => setConfirming(true)}
          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          Refund instead
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1 text-right">
      <p className="text-xs text-slate-500">Customer can still recover this from My Orders. Refund it anyway?</p>
      <div className="flex justify-end gap-1.5">
        <button onClick={() => setConfirming(false)} disabled={loading} className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50">
          Cancel
        </button>
        <button onClick={refundInstead} disabled={loading} className="rounded-md bg-red-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-40">
          {loading ? "Refunding…" : "Confirm refund"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
