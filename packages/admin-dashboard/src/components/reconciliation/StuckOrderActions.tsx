"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function StuckOrderActions({ orderId, status }: { orderId: string; status: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"cancel" | "complete" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: "cancel" | "complete") {
    setLoading(action);
    setError(null);
    try {
      const res = await fetch(`/api/admin/stuck-orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="space-y-1 text-right">
      <div className="flex justify-end gap-1.5">
        {status === "received" ? (
          <button
            onClick={() => act("complete")}
            disabled={loading !== null}
            className="rounded-md bg-[#238D9D] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1E7E8D] disabled:opacity-40"
          >
            {loading === "complete" ? "Completing…" : "Force complete"}
          </button>
        ) : (
          <button
            onClick={() => act("cancel")}
            disabled={loading !== null}
            className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
          >
            {loading === "cancel" ? "Cancelling…" : "Cancel & refund"}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
