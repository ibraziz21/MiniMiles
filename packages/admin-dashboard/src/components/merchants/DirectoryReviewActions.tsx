"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DIRECTORY_SECTIONS,
  type DirectoryModerationAction,
  type DirectorySectionKey,
  type DirectoryStatus,
} from "@/lib/merchant-directory-review";
import { queueReturnPath, reviewHref } from "@/lib/queueNavigation";

const COPY: Record<
  DirectoryModerationAction,
  { title: string; button: string; pending: string; result: string }
> = {
  publish: {
    title: "Publish this profile?",
    button: "Publish",
    pending: "Publishing…",
    result: "Profile published",
  },
  request_changes: {
    title: "Request changes",
    button: "Send request",
    pending: "Sending…",
    result: "Changes requested",
  },
  suspend: {
    title: "Suspend profile?",
    button: "Suspend profile",
    pending: "Suspending…",
    result: "Profile suspended",
  },
  restore: {
    title: "Restore profile?",
    button: "Restore to paused",
    pending: "Restoring…",
    result: "Profile restored to paused",
  },
};

export function DirectoryReviewActions({
  merchantId,
  merchantName = "Merchant profile",
  status,
  canPublish = true,
  returnTo = "/ops-queue",
  nextMerchant,
  profilePreviewHref,
}: {
  merchantId: string;
  merchantName?: string;
  status: DirectoryStatus;
  canPublish?: boolean;
  returnTo?: string;
  profilePreviewHref?: string;
  nextMerchant?: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const [action, setAction] = useState<DirectoryModerationAction | null>(null);
  const [sections, setSections] = useState<DirectorySectionKey[]>([]);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DirectoryModerationAction | null>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);
  const back = queueReturnPath(returnTo);
  useEffect(() => {
    if (!message && !note) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [message, note]);

  function choose(value: DirectoryModerationAction) {
    triggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setError("");
    setAction(value);
  }
  async function submit() {
    if (!action || lock.current) return;
    if (
      (action === "request_changes" || action === "suspend") &&
      !message.trim()
    ) {
      setError("Add a message for the merchant.");
      messageRef.current?.focus();
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/directory-reviews/${merchantId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            affectedSections: sections,
            merchantSafeMessage: message.trim() || null,
            internalNote: note.trim() || null,
          }),
        }
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Couldn’t update the profile. Try again.");
        return;
      }
      setResult(action);
      setAction(null);
      setSections([]);
      setMessage("");
      setNote("");
      router.refresh();
    } catch {
      setError("Couldn’t connect. Check your connection and try again.");
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  if (result)
    return (
      <section
        aria-label="Review completed"
        className="rounded-card border border-border bg-white p-5 text-center"
      >
        <CheckCircle2
          className="mx-auto mb-3 h-9 w-9 text-primary"
          aria-hidden="true"
        />
        <h2
          ref={resultRef}
          tabIndex={-1}
          className="text-xl font-semibold text-ink outline-none"
        >
          {COPY[result].result}
        </h2>
        <p className="mt-2 break-words text-base text-ink-muted">
          {merchantName}
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {nextMerchant && (
            <Button asChild>
              <Link href={reviewHref(nextMerchant.id, back)}>Review next</Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href={back}>
              {back.startsWith("/directory-reviews")
                ? "Back to reviews"
                : "Back to queue"}
            </Link>
          </Button>
          {profilePreviewHref ? (
            <Button asChild variant="ghost">
              <Link href={profilePreviewHref}>View profile</Link>
            </Button>
          ) : (
            <Button variant="ghost" onClick={() => setResult(null)}>
              View profile
            </Button>
          )}
        </div>
      </section>
    );

  return (
    <>
      <div className="space-y-3">
        {status === "pending_review" && (
          <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex gap-2 border-t border-border bg-white px-4 py-3 lg:static lg:flex-wrap lg:border-0 lg:bg-transparent lg:p-0">
            <Button
              type="button"
              variant="outline"
              className="flex-1 lg:flex-none"
              onClick={() => choose("request_changes")}
            >
              Request changes
            </Button>
            <Button
              type="button"
              disabled={!canPublish}
              className="flex-1 lg:flex-none"
              onClick={() => choose("publish")}
            >
              Publish
            </Button>
          </div>
        )}
        {(status === "published" ||
          status === "paused" ||
          status === "pending_review") && (
          <details className="text-sm text-ink-muted">
            <summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              Other actions
            </summary>
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => choose("suspend")}
            >
              Suspend profile
            </Button>
          </details>
        )}
        {status === "suspended" && (
          <Button variant="outline" onClick={() => choose("restore")}>
            Restore to paused
          </Button>
        )}
        {(status === "draft" || status === "changes_requested") && (
          <p className="text-sm text-ink-muted">
            Waiting for the merchant to submit their profile.
          </p>
        )}
      </div>
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!busy && !open) setAction(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!result) triggerRef.current?.focus();
          }}
          hideClose
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto overscroll-contain p-5"
        >
          <DialogTitle>
            {action ? COPY[action].title : "Review profile"}
          </DialogTitle>
          <DialogDescription className="mt-2 break-words">
            {merchantName}
            {action === "publish"
              ? " will become visible in Akiba discovery."
              : action === "suspend"
              ? " will be hidden from Akiba discovery."
              : action === "restore"
              ? " will return to paused, not published."
              : " — explain what needs changing."}
          </DialogDescription>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="mt-5 space-y-4"
          >
            {(action === "request_changes" || action === "suspend") && (
              <>
                <label className="block text-sm font-medium text-ink">
                  {action === "request_changes"
                    ? "What needs changing?"
                    : "Reason for suspension"}
                  <span className="mt-1 block font-normal text-ink-muted">
                    Visible to the merchant
                  </span>
                  <textarea
                    ref={messageRef}
                    name="merchantMessage"
                    required
                    maxLength={1000}
                    rows={4}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    aria-invalid={Boolean(error && !message.trim())}
                    className="mt-2 w-full rounded-control border border-border p-3 text-base font-normal text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  />
                </label>
                <details className="text-sm text-ink-muted">
                  <summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    Affected sections (optional)
                  </summary>
                  <fieldset className="grid gap-1 sm:grid-cols-2">
                    <legend className="sr-only">
                      Affected profile sections
                    </legend>
                    {DIRECTORY_SECTIONS.map((section) => (
                      <label
                        key={section.key}
                        className="flex min-h-11 items-center gap-2"
                      >
                        <input
                          type="checkbox"
                          checked={sections.includes(section.key)}
                          onChange={() =>
                            setSections((current) =>
                              current.includes(section.key)
                                ? current.filter((key) => key !== section.key)
                                : [...current, section.key]
                            )
                          }
                          className="h-4 w-4 accent-primary"
                        />
                        {section.label}
                      </label>
                    ))}
                  </fieldset>
                </details>
              </>
            )}
            <details className="text-sm text-ink-muted">
              <summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                Internal note (optional)
              </summary>
              <label className="block">
                Only visible to Akiba staff
                <textarea
                  name="internalNote"
                  maxLength={2000}
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-2 w-full rounded-control border border-border p-3 text-base text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                />
              </label>
            </details>
            {error && (
              <p role="alert" className="text-sm text-danger">
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
                variant={action === "suspend" ? "destructive" : "default"}
                disabled={busy}
              >
                {action
                  ? busy
                    ? COPY[action].pending
                    : COPY[action].button
                  : "Confirm"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
