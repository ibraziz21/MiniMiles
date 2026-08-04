"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function ProgramVersionActions({ id, action }: { id: string; action: "publish" | "pause" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (action === "publish" && !confirm("Publish this version? It becomes immutable except for emergency pause.")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/referrals/program/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <Button size="sm" variant={action === "publish" ? "default" : "outline"} onClick={run} disabled={loading}>
        {loading ? "Working…" : action === "publish" ? "Publish" : "Pause"}
      </Button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
