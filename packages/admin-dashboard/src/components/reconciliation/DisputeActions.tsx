"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DisputeActions({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState<"received" | "cancelled" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function resolve(resolution: "received" | "cancelled") {
    setLoading(resolution);
    setError(null);
    try {
      const res = await fetch(`/api/admin/disputes/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to resolve");
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
    <div className="space-y-1">
      <div className="flex gap-1.5">
        <button
          onClick={() => resolve("received")}
          disabled={loading !== null}
          className="rounded-md bg-[#238D9D] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1E7E8D]"
        >
          {loading === "received" ? "Resolving…" : "Resolve → received"}
        </button>
        <button
          onClick={() => resolve("cancelled")}
          disabled={loading !== null}
          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          {loading === "cancelled" ? "Cancelling…" : "Cancel & refund"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
