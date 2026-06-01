"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const statuses = ["new", "contacted", "qualified", "closed"] as const;

type LeadKind = "partner" | "merchant";
type LeadStatus = (typeof statuses)[number];

interface LeadStatusSelectProps {
  kind: LeadKind;
  leadId: string;
  initialStatus: LeadStatus;
}

export function LeadStatusSelect({
  kind,
  leadId,
  initialStatus,
}: LeadStatusSelectProps) {
  const router = useRouter();
  const [status, setStatus] = useState<LeadStatus>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function updateStatus(nextStatus: LeadStatus) {
    setStatus(nextStatus);
    setSaving(true);
    setError("");

    try {
      const res = await fetch(`/api/admin/leads/${kind}/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setStatus(initialStatus);
        setError(body.error ?? "Failed to update lead");
        return;
      }

      router.refresh();
    } catch {
      setStatus(initialStatus);
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1">
      <select
        value={status}
        disabled={saving}
        onChange={(event) => updateStatus(event.target.value as LeadStatus)}
        className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium capitalize text-slate-700 outline-none transition focus:border-[#238D9D] focus:ring-2 focus:ring-[#238D9D]/20 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label="Lead status"
      >
        {statuses.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
