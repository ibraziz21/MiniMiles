"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function FundActions({
  fundId,
  state,
  approvalRevision,
  version,
  startsAt,
  endsAt,
  canWrite,
  canApprove,
  canPublish,
}: {
  fundId: string;
  state: string;
  approvalRevision: number;
  version: number;
  startsAt: string;
  endsAt: string;
  canWrite: boolean;
  canApprove: boolean;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);

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
    setRescheduling(false);
    router.refresh();
  }

  const canReschedule = canPublish && ["approved", "scheduled", "active", "paused"].includes(state);

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
        {canReschedule && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setRescheduling((r) => !r)}>
            Reschedule
          </Button>
        )}
      </div>

      {rescheduling && (
        <RescheduleForm
          initialStartsAt={startsAt}
          initialEndsAt={endsAt}
          busy={busy}
          onCancel={() => setRescheduling(false)}
          onSubmit={(startsAtValue, endsAtValue, reason) =>
            void act("reschedule", { startsAt: startsAtValue, endsAt: endsAtValue, expectedVersion: version, reason })
          }
        />
      )}
    </div>
  );
}

function RescheduleForm({
  initialStartsAt,
  initialEndsAt,
  busy,
  onCancel,
  onSubmit,
}: {
  initialStartsAt: string;
  initialEndsAt: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (startsAt: string, endsAt: string, reason: string) => void;
}) {
  const [startsAt, setStartsAt] = useState(initialStartsAt.slice(0, 16));
  const [endsAt, setEndsAt] = useState(initialEndsAt.slice(0, 16));
  const [reason, setReason] = useState("");

  return (
    <div className="max-w-md space-y-2 rounded-lg border border-slate-200 p-3">
      <p className="text-xs font-medium text-slate-600">Correct this fund&apos;s start/end dates</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-xs text-slate-500">Starts</span>
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </label>
        <label className="block space-y-1">
          <span className="text-xs text-slate-500">Ends</span>
          <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </label>
      </div>
      <Input placeholder="Reason (min 4 characters)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={busy || reason.trim().length < 4 || !startsAt || !endsAt}
          onClick={() => onSubmit(new Date(startsAt).toISOString(), new Date(endsAt).toISOString(), reason.trim())}
        >
          Save new dates
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
