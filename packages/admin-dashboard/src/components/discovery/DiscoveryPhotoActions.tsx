"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DISCOVERY_PHOTO_REJECTION_REASONS } from "@/lib/discoveryModeration";

export function DiscoveryPhotoPreview({
  photoId,
  reviewLink = false,
  large = false,
}: {
  photoId: string;
  reviewLink?: boolean;
  large?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(false);
    fetch(`/api/admin/discovery-photos/${photoId}/preview-url`, {
      method: "POST",
      cache: "no-store",
    })
      .then(async (res) => {
        const payload = await res.json();
        if (
          !res.ok ||
          typeof payload.url !== "string" ||
          !/^https?:\/\//.test(payload.url)
        )
          throw new Error("Unavailable");
        return payload.url as string;
      })
      .then((value) => {
        if (!cancelled) setUrl(value);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [photoId, attempt]);
  const box = large
    ? "flex min-h-52 w-full items-center justify-center rounded-card bg-surface-subtle p-4"
    : "flex h-16 w-16 shrink-0 items-center justify-center rounded-control bg-surface-subtle";
  if (error)
    return (
      <div className={box}>
        <div className="text-center">
          <p className="text-sm text-ink-muted">Photo unavailable</p>
          {large && (
            <button
              type="button"
              onClick={() => setAttempt((value) => value + 1)}
              className="mt-2 min-h-11 rounded-control px-3 text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    );
  if (!url)
    return (
      <div className={box} role="status">
        <span className="text-sm text-ink-muted">Loading…</span>
      </div>
    );
  // eslint-disable-next-line @next/next/no-img-element
  const image = (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      width={large ? 960 : 128}
      height={large ? 720 : 128}
      loading="lazy"
      onError={() => setError(true)}
      alt="Submitted visit photo for moderation"
      className={
        large
          ? "max-h-[55dvh] w-full rounded-card bg-surface-subtle object-contain"
          : "h-16 w-16 rounded-control object-cover"
      }
    />
  );
  return reviewLink ? (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-card text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      {image}
      <span className="inline-flex min-h-11 items-center">
        Open full photo<span className="sr-only"> in a new tab</span>
      </span>
    </a>
  ) : (
    image
  );
}

export function DiscoveryPhotoActions({ photoId }: { photoId: string }) {
  const router = useRouter();
  const [reasonCode, setReasonCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const lock = useRef(false);
  const decisionTrigger = useRef<HTMLButtonElement | null>(null);
  async function runAction() {
    if (!action || lock.current) return;
    if (action === "reject" && !reasonCode) {
      setError("Choose a rejection reason.");
      return;
    }
    lock.current = true;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/discovery-photos/${photoId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          reasonCode: action === "reject" ? reasonCode : undefined,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Couldn’t update the photo. Try again.");
        return;
      }
      setResult(action === "approve" ? "Photo approved" : "Photo rejected");
      setAction(null);
      router.refresh();
    } catch {
      setError(
        "Couldn’t connect. Refresh to check the photo’s status before retrying."
      );
    } finally {
      lock.current = false;
      setLoading(false);
    }
  }
  if (result)
    return (
      <p
        role="status"
        className="rounded-control bg-primary/10 p-4 text-base font-medium text-primary-strong"
      >
        {result}
      </p>
    );
  return (
    <>
      <div className="flex gap-2">
        <Button
          variant="outline"
          className="flex-1 sm:flex-none"
          onClick={(event) => {
            decisionTrigger.current = event.currentTarget;
            setError("");
            setAction("reject");
          }}
        >
          Reject
        </Button>
        <Button
          className="flex-1 sm:flex-none"
          onClick={(event) => {
            decisionTrigger.current = event.currentTarget;
            setError("");
            setAction("approve");
          }}
        >
          Approve
        </Button>
      </div>
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!loading && !open) setAction(null);
        }}
      >
        <DialogContent
          hideClose
          className="w-[calc(100%-2rem)] max-w-sm p-5"
          onCloseAutoFocus={(event) => {
            if (decisionTrigger.current?.isConnected) {
              event.preventDefault();
              decisionTrigger.current.focus();
            }
          }}
        >
          <DialogTitle>
            {action === "reject" ? "Reject photo" : "Approve photo?"}
          </DialogTitle>
          <DialogDescription className="mt-2">
            {action === "reject"
              ? "Choose why this photo should not be published."
              : "This photo can become eligible for public discovery."}
          </DialogDescription>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void runAction();
            }}
          >
            {action === "reject" && (
              <label className="block text-sm font-medium text-ink">
                Rejection reason
                <select
                  name="reason"
                  required
                  value={reasonCode}
                  onChange={(event) => setReasonCode(event.target.value)}
                  className="mt-2 min-h-11 w-full rounded-control border border-border bg-white px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  <option value="">Choose a reason</option>
                  {DISCOVERY_PHOTO_REJECTION_REASONS.map((reason) => (
                    <option key={reason.value} value={reason.value}>
                      {reason.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                type="button"
                disabled={loading}
                onClick={() => setAction(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={loading}
                variant={action === "reject" ? "destructive" : "default"}
              >
                {loading
                  ? "Saving…"
                  : action === "reject"
                  ? "Reject photo"
                  : "Approve photo"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Emergency suppression for an already-approved (currently public) photo —
 * hardening spec §7.1/§8.3. Independent of approve/reject: it works on a
 * live photo and does not touch moderation_status.
 */
export function DiscoverySuppressionActions({
  photoId,
  suppressed,
}: {
  photoId: string;
  suppressed: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runAction() {
    setError("");
    setLoading(true);
    try {
      const response = await fetch(
        `/api/admin/discovery-photos/${photoId}/suppress`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            suppressed: !suppressed,
            reasonCode: !suppressed ? reason.trim() || undefined : undefined,
          }),
        }
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "The photo could not be updated.");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error. Check your connection and try again.");
    } finally {
      setLoading(false);
      setConfirming(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {!suppressed && (
        <label className="text-sm text-ink-muted">
          Reason (optional)
          <input
            name="suppressionReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Suppression reason (optional, 64 chars max)"
            maxLength={64}
            className="mt-2 h-11 w-full rounded-control border border-border px-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
      )}
      <Button
        type="button"
        size="sm"
        variant={suppressed ? "default" : "destructive"}
        disabled={loading}
        onClick={() => setConfirming(true)}
      >
        {loading ? "Saving…" : suppressed ? "Restore photo" : "Hide photo"}
      </Button>
      <ConfirmActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={suppressed ? "Restore this photo?" : "Hide this photo?"}
        description={
          suppressed
            ? "Remove the moderation hold. Other public eligibility rules still apply."
            : "Hide this photo from public discovery. Existing signed links may remain valid for up to five minutes."
        }
        confirmLabel={suppressed ? "Restore photo" : "Hide photo"}
        variant={suppressed ? "default" : "destructive"}
        onConfirm={runAction}
      />
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
