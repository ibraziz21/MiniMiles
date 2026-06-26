"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

const STATE_LABELS: Record<string, string> = {
  active: "Activate",
  paused: "Pause",
  ended:  "End Program",
};

const STATE_VARIANTS: Record<string, "default" | "outline" | "destructive"> = {
  active: "default",
  paused: "outline",
  ended:  "destructive",
};

interface Props {
  programId:    string;
  currentState: string;
  nextStates:   string[];
}

export default function ProgramActions({ programId, currentState, nextStates }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function transition(newState: string) {
    if (newState === "ended" && !confirm("End this program? This cannot be undone.")) return;
    setError(null);
    setLoading(newState);
    try {
      const res = await fetch(`/api/programs/${programId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state: newState }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to update");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-red-500">{error}</span>}
      {nextStates.map((s) => (
        <Button
          key={s}
          size="sm"
          variant={STATE_VARIANTS[s] ?? "outline"}
          disabled={loading !== null}
          onClick={() => transition(s)}
        >
          {loading === s ? "…" : STATE_LABELS[s] ?? s}
        </Button>
      ))}
    </div>
  );
}
