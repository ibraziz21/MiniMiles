"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";

export function DisputeButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason.trim()) {
      setError("Tell us what happened.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/shop/orders/${orderId}/dispute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not open dispute");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-xl border border-akiba-line py-2 text-xs font-semibold text-akiba-muted hover:border-red-300 hover:text-red-500"
      >
        I didn&apos;t receive this
      </button>
    );
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-red-200 bg-red-50 p-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-red-700">
        <AlertCircle className="h-3.5 w-3.5" /> What happened?
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        placeholder="e.g. Never arrived, wrong item, damaged…"
        className="w-full rounded-lg border border-red-200 px-3 py-2 text-xs outline-none focus:border-red-400"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => { setOpen(false); setError(null); }}
          disabled={loading}
          className="flex-1 rounded-lg border border-red-200 py-1.5 text-xs font-semibold text-red-700"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={loading}
          className="flex-1 rounded-lg bg-red-500 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {loading ? "Submitting…" : "Report issue"}
        </button>
      </div>
    </div>
  );
}
