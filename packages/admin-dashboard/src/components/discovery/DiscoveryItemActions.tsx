"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DiscoveryItemActions({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [mergeTarget, setMergeTarget] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function runAction(action: "qualify" | "suppress" | "merge_into") {
    setError("");
    if (action === "merge_into" && !mergeTarget.trim()) {
      setError("Paste the target item ID to merge into.");
      return;
    }
    setLoading(action);
    try {
      const response = await fetch(`/api/admin/discovery-items/${itemId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, mergeIntoItemId: action === "merge_into" ? mergeTarget.trim() : undefined }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "The item could not be updated.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={loading !== null} onClick={() => runAction("qualify")}>
          {loading === "qualify" ? "Qualifying..." : "Qualify now"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={loading !== null}
          onClick={() => runAction("suppress")}
        >
          {loading === "suppress" ? "Suppressing..." : "Suppress"}
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <input
          value={mergeTarget}
          onChange={(event) => setMergeTarget(event.target.value)}
          placeholder="Merge into item ID"
          className="h-8 w-56 rounded-lg border border-slate-200 px-2 text-xs text-slate-900 placeholder:text-slate-400"
        />
        <Button type="button" size="sm" variant="outline" disabled={loading !== null} onClick={() => runAction("merge_into")}>
          {loading === "merge_into" ? "Merging..." : "Merge"}
        </Button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
