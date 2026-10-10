"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Mode = "idle" | "requeue" | "void" | "reverse" | "reject";

const LABELS: Record<Exclude<Mode, "idle">, string> = {
  requeue: "Requeue job",
  void: "Void job",
  reverse: "Reverse job",
  reject: "Reject referral",
};

/**
 * Row-level admin actions for the referral review queue
 * (referral-system-spec.md §11.2). requeue/void/reverse operate on the
 * reward job; reject operates on the whole referral (voids every
 * un-released job for it). Every action requires a reason, written to
 * admin_audit_logs by the API route.
 */
export function ReferralJobActions({
  jobId,
  referralId,
  jobStatus,
  showReverse,
}: {
  jobId: string;
  referralId: string;
  jobStatus: string;
  showReverse: boolean;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("idle");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (mode === "idle") return;
    setLoading(true);
    setError(null);
    try {
      const res =
        mode === "reject"
          ? await fetch(`/api/admin/referrals/${referralId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "reject", reason }),
            })
          : await fetch(`/api/admin/referrals/jobs/${jobId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: mode, reason }),
            });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Action failed");
        return;
      }
      setMode("idle");
      setReason("");
      router.refresh();
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (mode === "idle") {
    return (
      <div className="flex flex-wrap gap-1.5">
        {jobStatus === "manual_review" && (
          <button
            onClick={() => setMode("requeue")}
            className="rounded-control bg-primary px-2.5 py-1 text-xs font-medium text-white hover:bg-primary-strong"
          >
            Requeue
          </button>
        )}
        <button
          onClick={() => setMode("void")}
          className="rounded-control border border-border px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-subtle"
        >
          Void
        </button>
        {showReverse && (
          <button
            onClick={() => setMode("reverse")}
            className="rounded-control border border-border px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-subtle"
          >
            Reverse
          </button>
        )}
        <button
          onClick={() => setMode("reject")}
          className="rounded-control border border-danger/30 px-2.5 py-1 text-xs text-danger hover:bg-danger/5"
        >
          Reject referral
        </button>
      </div>
    );
  }

  return (
    <div className="w-56 space-y-1.5">
      <p className="text-xs font-medium text-ink">{LABELS[mode]}</p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required — written to the audit log)"
        rows={2}
        className="w-full rounded-control border border-border px-2 py-1 text-xs"
      />
      <div className="flex gap-1.5">
        <button
          onClick={() => { setMode("idle"); setReason(""); setError(null); }}
          disabled={loading}
          className="rounded-control border border-border px-2.5 py-1 text-xs text-ink-muted hover:bg-surface-subtle"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={loading || !reason.trim()}
          className="rounded-control bg-primary px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          {loading ? "Saving…" : "Confirm"}
        </button>
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
