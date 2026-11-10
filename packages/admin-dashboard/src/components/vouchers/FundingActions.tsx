"use client";
import Link from "next/link";
import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  toNairobiDateTimeInput,
  fromNairobiDateTimeInput,
} from "@/lib/voucherFundDates";
export type FundingActionsProps = {
  fundId: string;
  allocationId?: string;
  state: string;
  canWrite: boolean;
  canApprove: boolean;
  canPublish: boolean;
  approvalRevision?: number;
  version?: number;
  startsAt?: string;
  endsAt?: string;
};
export function FundingActions({
  fundId,
  allocationId,
  state,
  canWrite,
  canApprove,
  canPublish,
  approvalRevision,
  version,
  startsAt,
  endsAt,
}: FundingActionsProps) {
  const router = useRouter(),
    lock = useRef(false);
  const [action, setAction] = useState<string | null>(null),
    [reason, setReason] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [newStart, setNewStart] = useState(
      startsAt ? toNairobiDateTimeInput(startsAt) : ""
    ),
    [newEnd, setNewEnd] = useState(
      endsAt ? toNairobiDateTimeInput(endsAt) : ""
    );
  const base = allocationId
      ? `/api/admin/voucher-allocations/${allocationId}`
      : `/api/admin/voucher-funds/${fundId}`,
    label = allocationId ? "allocation" : "fund";
  const actions: Array<{ id: string; label: string; danger?: boolean }> = [];
  if (state === "draft" && canWrite)
    actions.push(
      { id: "submit", label: "Submit" },
      ...(allocationId
        ? [{ id: "delete", label: "Delete draft", danger: true }]
        : [])
    );
  if (state === "pending_approval" && canApprove)
    actions.push({ id: "reject", label: "Return to draft", danger: true });
  if (["pending_approval", "approved"].includes(state) && canPublish)
    actions.push({ id: "publish", label: `Publish ${label}` });
  if (["active", "scheduled"].includes(state) && canPublish)
    actions.push(
      { id: "pause", label: "Pause" },
      { id: "end", label: "End", danger: true }
    );
  if (["paused", "exhausted"].includes(state) && canPublish) {
    if (state === "paused") actions.push({ id: "resume", label: "Resume" });
    actions.push({ id: "end", label: "End", danger: true });
  }
  if (
    !allocationId &&
    canPublish &&
    ["approved", "scheduled", "active", "paused"].includes(state)
  )
    actions.push({ id: "reschedule", label: "Reschedule" });
  const reasonRequired =
    action === "reject" ||
    (!allocationId && ["approve", "reschedule"].includes(action ?? ""));
  async function act() {
    if (!action || lock.current) return;
    if (reasonRequired && reason.trim().length < 4) {
      setError("Enter a reason of at least 4 characters.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        reason: reason.trim() || undefined,
      };
      if (action === "publish" && !allocationId)
        body.expectedRevision = approvalRevision;
      if (action === "reschedule") {
        body.startsAt = fromNairobiDateTimeInput(newStart);
        body.endsAt = fromNairobiDateTimeInput(newEnd);
        body.expectedVersion = version;
      }
      const response = await fetch(
        action === "delete" ? base : `${base}/${action}`,
        {
          method: action === "delete" ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: action === "delete" ? undefined : JSON.stringify(body),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.error ?? "Could not complete this action.");
        return;
      }
      setAction(null);
      if (action === "delete") router.push(`/vouchers/funds/${fundId}`);
      else if (action === "publish" && allocationId)
        router.push(
          `/vouchers/funds/${fundId}/allocations/${allocationId}/review?published=1`
        );
      router.refresh();
    } catch {
      setError(
        "Couldn’t connect. Refresh to check the saved state before retrying."
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {state === "draft" && canWrite && (
          <Button asChild variant="outline">
            <Link
              href={
                allocationId
                  ? `/vouchers/funds/${fundId}/allocations/${allocationId}/edit`
                  : `/vouchers/funds/${fundId}/edit`
              }
            >
              Edit draft
            </Link>
          </Button>
        )}
        {actions.map((item) => (
          <Dialog
            key={item.id}
            open={action === item.id}
            onOpenChange={(open) => {
              if (!busy) {
                setAction(open ? item.id : null);
                setReason("");
                setError("");
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                variant={item.danger ? "outline" : "default"}
                disabled={busy}
              >
                {item.label}
              </Button>
            </DialogTrigger>
            <DialogContent hideClose className="w-[calc(100%-2rem)] max-w-md">
              <DialogTitle>
                {item.label}
                {item.id === "submit" || item.id === "delete" ? "?" : ""}
              </DialogTitle>
              <DialogDescription className="mt-2">
                {item.id === "publish"
                  ? `Publish this ${label}. Availability follows its saved schedule.`
                  : item.id === "end"
                  ? `Stop new claims permanently. Already-issued vouchers remain valid.`
                  : item.id === "delete"
                  ? "Permanently remove this draft allocation. This cannot be undone."
                  : item.id === "submit"
                  ? "Submit this draft. You can publish it next."
                  : item.id === "reschedule"
                  ? "Correct the fund schedule in East Africa Time. Existing version checks still apply."
                  : `Your decision will be recorded for this ${label}.`}
              </DialogDescription>
              <form
                className="mt-4 space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void act();
                }}
              >
                {item.id === "reschedule" && (
                  <div className="grid gap-3">
                    <label className="text-sm">
                      Starts (EAT)
                      <Input
                        className="mt-2 h-11 min-w-0 text-base"
                        type="datetime-local"
                        required
                        value={newStart}
                        onChange={(e) => setNewStart(e.target.value)}
                      />
                    </label>
                    <label className="text-sm">
                      Ends (EAT)
                      <Input
                        className="mt-2 h-11 min-w-0 text-base"
                        type="datetime-local"
                        required
                        min={newStart || undefined}
                        value={newEnd}
                        onChange={(e) => setNewEnd(e.target.value)}
                      />
                    </label>
                  </div>
                )}
                {!["submit", "delete", "publish", "resume"].includes(
                  item.id
                ) && (
                  <label className="block text-sm">
                    Reason {reasonRequired ? "(required)" : "(optional)"}
                    <Input
                      className="mt-2 h-11 min-w-0 text-base"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required={reasonRequired}
                      minLength={reasonRequired ? 4 : undefined}
                    />
                  </label>
                )}
                {error && (
                  <p role="alert" className="break-words text-sm text-danger">
                    {error}
                  </p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setAction(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant={item.danger ? "destructive" : "default"}
                    disabled={busy}
                  >
                    {busy ? "Saving…" : item.label}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        ))}
      </div>
      {!actions.length && state === "pending_approval" && (
        <p className="text-sm text-ink-muted">
          Ready for an authorized publisher.
        </p>
      )}
    </div>
  );
}
