"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export function FundActions({
  fundId,
  state,
  approvalRevision,
  canWrite,
  canApprove,
  canPublish,
}: {
  fundId: string;
  state: string;
  approvalRevision: number;
  canWrite: boolean;
  canApprove: boolean;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(action: string, body: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/voucher-funds/${fundId}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(result.error ?? "Action failed.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
      <div className="flex flex-wrap gap-2">
        {state === "draft" && canWrite && (
          <>
            <Button asChild variant="outline" size="sm">
              <Link href={`/vouchers/funds/${fundId}/edit`}>Edit</Link>
            </Button>
            <Button size="sm" disabled={busy} onClick={() => void act("submit")}>
              Submit for approval
            </Button>
          </>
        )}
        {state === "pending_approval" && canApprove && (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                const reason = prompt("Approval reason (min 4 characters)");
                if (reason) void act("approve", { reason });
              }}
            >
              Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const reason = prompt("Rejection reason");
                if (reason) void act("reject", { reason });
              }}
            >
              Reject
            </Button>
          </>
        )}
        {state === "approved" && canPublish && (
          <Button size="sm" disabled={busy} onClick={() => void act("publish", { expectedRevision: approvalRevision })}>
            Publish
          </Button>
        )}
        {(state === "scheduled" || state === "active") && canPublish && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                const reason = prompt("Reason for pausing (optional)") ?? undefined;
                void act("pause", { reason });
              }}
            >
              Pause
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!confirm("End this fund permanently? Issued vouchers remain valid.")) return;
                const reason = prompt("Reason for ending (optional)") ?? undefined;
                void act("end", { reason });
              }}
            >
              End
            </Button>
          </>
        )}
        {state === "paused" && canPublish && (
          <>
            <Button size="sm" disabled={busy} onClick={() => void act("resume")}>
              Resume
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                if (!confirm("End this fund permanently? Issued vouchers remain valid.")) return;
                void act("end");
              }}
            >
              End
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
