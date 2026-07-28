"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RefundActions({ id }: { id: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "refunded" | "not_applicable">("idle");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(status: "refunded" | "not_applicable") {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/refunds/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          status === "refunded" ? { status, refund_tx_hash: value } : { status, notes: value },
        ),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update");
        return;
      }
      setMode("idle");
      setValue("");
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "idle") {
    return (
      <div className="flex gap-1.5">
        <button
          onClick={() => setMode("refunded")}
          className="rounded-md bg-[#238D9D] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1E7E8D]"
        >
          Mark refunded
        </button>
        <button
          onClick={() => setMode("not_applicable")}
          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Not applicable
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={mode === "refunded" ? "Tx hash / M-Pesa receipt" : "Note (optional)"}
        className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs"
      />
      <div className="flex gap-1.5">
        <button
          onClick={() => { setMode("idle"); setValue(""); setError(null); }}
          disabled={loading}
          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
        >
          Cancel
        </button>
        <button
          onClick={() => submit(mode)}
          disabled={loading || (mode === "refunded" && !value.trim())}
          className="rounded-md bg-[#238D9D] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1E7E8D] disabled:opacity-40"
        >
          {loading ? "Saving…" : "Confirm"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
