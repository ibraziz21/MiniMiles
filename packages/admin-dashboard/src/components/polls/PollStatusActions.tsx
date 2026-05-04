"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { PollStatus } from "@/types";

const NEXT_STATUS: Record<PollStatus, PollStatus | null> = {
  draft: "live",
  live: "closed",
  closed: "verified",
  verified: null,
};

const NEXT_LABEL: Record<PollStatus, string> = {
  draft: "Publish (set Live)",
  live: "Close Poll",
  closed: "Mark Verified",
  verified: "",
};

interface PollStatusActionsProps {
  pollId: string;
  currentStatus: PollStatus;
  canWrite: boolean;
}

export function PollStatusActions({ pollId, currentStatus, canWrite }: PollStatusActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const next = NEXT_STATUS[currentStatus];
  if (!next || !canWrite) {
    return <p className="text-sm text-slate-400">{currentStatus === "verified" ? "This poll is verified. No further actions." : "No actions available."}</p>;
  }

  async function advance() {
    setError("");
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/polls/${pollId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const d = await res.json();
        setError(d.error ?? "Failed");
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
    <div className="flex items-center gap-3">
      <Button onClick={advance} disabled={loading} variant={next === "closed" ? "outline" : "default"}>
        {loading ? "Updating…" : NEXT_LABEL[currentStatus]}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
