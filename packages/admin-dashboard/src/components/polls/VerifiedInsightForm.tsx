"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { VerifiedInsight } from "@/types";

interface VerifiedInsightFormProps {
  pollId: string;
  existing: VerifiedInsight | null;
}

export function VerifiedInsightForm({ pollId, existing }: VerifiedInsightFormProps) {
  const router = useRouter();
  const [summary, setSummary] = useState(existing?.summary ?? "");
  const [findings, setFindings] = useState((existing?.key_findings ?? []).join("\n"));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSaved(false);
    try {
      const key_findings = findings.trim() ? findings.split("\n").map((l) => l.trim()).filter(Boolean) : [];
      const res = await fetch(`/api/admin/polls/${pollId}/verified-insight`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summary, key_findings }),
      });
      if (!res.ok) { const d = await res.json(); setError(d.error ?? "Failed"); return; }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Summary</label>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          rows={4}
          placeholder="Write a verified summary of the poll findings…"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#238D9D]"
        />
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-700">Key Findings (one per line)</label>
        <textarea
          value={findings}
          onChange={(e) => setFindings(e.target.value)}
          rows={4}
          placeholder={"73% of respondents prefer X\nPrice sensitivity highest in Nairobi"}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#238D9D] font-mono"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={loading || !summary.trim()}>
          {loading ? "Saving…" : existing ? "Update Insight" : "Save Insight"}
        </Button>
        {saved && <p className="text-sm text-emerald-600">Saved!</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </form>
  );
}
