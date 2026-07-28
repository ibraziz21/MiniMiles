"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  jobId: string;
  status: "pending" | "processing" | "delivered" | "failed";
}

export function FulfillmentJobActions({ jobId, status }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "deliver" | "fail">("idle");
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(action: "deliver" | "fail" | "retry") {
    setLoading(true);
    setError(null);
    try {
      const body =
        action === "deliver" ? { action, provider_ref: value } :
        action === "fail" ? { action, error: value } :
        { action };

      const res = await fetch(`/api/admin/fulfillment/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Action failed");
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

  if (status === "delivered") {
    return <span className="text-xs text-emerald-600">Delivered</span>;
  }

  if (status === "failed") {
    return (
      <div className="space-y-1">
        <button
          disabled={loading}
          onClick={() => submit("retry")}
          className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          {loading ? "Retrying…" : "Retry"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  if (mode === "idle") {
    return (
      <div className="flex gap-1.5">
        <button
          onClick={() => setMode("deliver")}
          className="rounded-md bg-[#238D9D] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1E7E8D]"
        >
          Mark delivered
        </button>
        <button
          onClick={() => setMode("fail")}
          className="rounded-md border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
        >
          Mark failed
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={mode === "deliver" ? "Top-up / code reference" : "What went wrong?"}
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
          disabled={loading || !value.trim()}
          className="rounded-md bg-[#238D9D] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#1E7E8D] disabled:opacity-40"
        >
          {loading ? "Saving…" : "Confirm"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
