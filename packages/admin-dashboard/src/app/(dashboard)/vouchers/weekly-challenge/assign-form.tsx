"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface AllocationOption {
  programId: string;
  label: string;
  remaining: number | null;
}

function mondayOf(date: Date): string {
  const day = date.getUTCDay() || 7;
  const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - (day - 1)));
  return monday.toISOString().slice(0, 10);
}

export function AssignSponsorForm({ allocations }: { allocations: AllocationOption[] }) {
  const router = useRouter();
  const today = new Date();
  const defaultFrom = mondayOf(today);
  const defaultTo = new Date(new Date(defaultFrom).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  const [programId, setProgramId] = useState(allocations[0]?.programId ?? "");
  const [weekFrom, setWeekFrom] = useState(defaultFrom);
  const [weekTo, setWeekTo] = useState(defaultTo);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/weekly-challenge/assign-sponsor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          program_id: programId,
          week_from: weekFrom,
          week_to: weekTo,
          game_types: ["rule_tap", "memory_flip"],
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? "Failed to assign sponsor");
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  if (allocations.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No active weekly_leaderboard_challenge allocations with remaining capacity.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-5 sm:items-end">
      <div className="sm:col-span-2">
        <label className="mb-1 block text-xs font-medium text-slate-500">Sponsor allocation</label>
        <Select value={programId} onValueChange={setProgramId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {allocations.map((a) => (
              <SelectItem key={a.programId} value={a.programId}>
                {a.label} {a.remaining !== null ? `(${a.remaining} left)` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Week from</label>
        <Input type="date" value={weekFrom} onChange={(e) => setWeekFrom(e.target.value)} required />
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Week to</label>
        <Input type="date" value={weekTo} onChange={(e) => setWeekTo(e.target.value)} required />
      </div>

      <div>
        <Button type="submit" disabled={submitting} className="w-full">
          {submitting ? "Assigning…" : "Assign sponsor"}
        </Button>
      </div>

      {error && <p className="sm:col-span-5 text-sm text-red-600">{error}</p>}
    </form>
  );
}
