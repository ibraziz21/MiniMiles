"use client";
/* eslint-disable @next/next/no-img-element -- Merchant-hosted media uses dynamic public asset URLs. */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Store, ShieldCheck, Timer, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DEFAULT_TRIAL_DAYS, MAX_TRIAL_DAYS } from "@/lib/subscriptionTrials";

interface GrantTrialControlProps {
  merchantId: string;
  canManage: boolean;
  subscriptionStatus?: string | null;
  merchantName?: string;
  location?: string;
  imageUrl?: string | null;
}

export function GrantTrialControl({
  merchantId,
  canManage,
  subscriptionStatus,
  merchantName,
  location,
  imageUrl,
}: GrantTrialControlProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(DEFAULT_TRIAL_DAYS);
  const [submitting, setSubmitting] = useState(false);
  const [isRefreshing, startTransition] = useTransition();
  const [message, setMessage] = useState<{
    kind: "error" | "success";
    text: string;
  } | null>(null);

  const isPaid =
    subscriptionStatus === "active" || subscriptionStatus === "past_due";
  const disabled = submitting || isRefreshing || isPaid || !canManage;

  async function grantTrial() {
    setMessage(null);
    setSubmitting(true);
    try {
      const response = await fetch(`/api/admin/merchants/${merchantId}/trial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ days }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setMessage({
          kind: "error",
          text: data.error ?? "Could not grant the trial.",
        });
        return;
      }

      setMessage({ kind: "success", text: `${days}-day trial granted.` });
      startTransition(() => router.refresh());
    } catch {
      setMessage({ kind: "error", text: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h3 className="flex items-center gap-3 font-semibold text-ink">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-[#D9F9FC]">
          <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        </span>
        Administrative trial
      </h3>
      <p className="mt-1 text-sm text-ink-muted">
        Temporary access for eligible unpaid merchants.
      </p>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!submitting && !isRefreshing) {
            setOpen(value);
            setMessage(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button
            className="mt-5 h-12 w-full bg-[#E2E7FF] text-primary-strong hover:bg-[#DAE2FD]"
            variant="secondary"
            disabled={disabled}
          >
            Grant trial
          </Button>
        </DialogTrigger>
        <DialogContent
          hideClose
          className="bottom-0 top-auto max-h-[92dvh] translate-y-0 overflow-y-auto rounded-b-none border-0 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-sheet"
        >
          <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[#BDCAC6] sm:hidden" />
          <div className="flex items-center justify-between gap-3">
            <DialogTitle>Grant trial</DialogTitle>
            <button
              type="button"
              aria-label="Close trial"
              disabled={submitting || isRefreshing}
              onClick={() => setOpen(false)}
              className="flex h-11 w-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-control bg-[#F2F3FF] p-3">
            {imageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */ <img
                src={imageUrl}
                alt=""
                width={44}
                height={44}
                className="h-11 w-11 rounded-control object-cover"
              />
            ) : (
              <Store className="h-6 w-6 text-primary" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className="font-medium">{merchantName || "Merchant"}</p>
              <p className="text-sm text-ink-muted">{location}</p>
            </div>
          </div>
          <DialogDescription className="mt-2">
            Choose a trial duration. Paid subscriptions cannot receive a trial.
          </DialogDescription>
          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void grantTrial();
            }}
          >
            <fieldset disabled={submitting || isRefreshing}>
              <legend className="text-sm font-medium">Duration</legend>
              <div className="mt-2 flex gap-2">
                {[DEFAULT_TRIAL_DAYS, 14, 30].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={days === value}
                    onClick={() => setDays(value)}
                    className={`min-h-11 flex-1 rounded-control border px-2 text-sm focus-visible:outline-primary ${
                      days === value
                        ? "border-primary bg-primary/10 text-primary-strong"
                        : "border-border"
                    }`}
                  >
                    {value} days
                  </button>
                ))}
              </div>
              <label className="mt-4 block text-sm font-medium">
                Custom duration (1–{MAX_TRIAL_DAYS} days)
                <Input
                  className="mt-2 h-11 text-base"
                  type="number"
                  min={1}
                  max={MAX_TRIAL_DAYS}
                  step={1}
                  value={days}
                  required
                  onChange={(event) => setDays(Number(event.target.value))}
                />
              </label>
            </fieldset>
            {message && (
              <p
                role={message.kind === "error" ? "alert" : "status"}
                className={`text-sm ${
                  message.kind === "error"
                    ? "text-danger"
                    : "text-primary-strong"
                }`}
              >
                {message.text}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2">
              <Button
                className="w-full"
                type="button"
                variant="outline"
                disabled={submitting || isRefreshing}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                className="w-full"
                type="submit"
                disabled={
                  disabled ||
                  message?.kind === "success" ||
                  !Number.isInteger(days) ||
                  days < 1 ||
                  days > MAX_TRIAL_DAYS
                }
              >
                {submitting || isRefreshing ? "Granting…" : "Grant trial"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {isPaid && (
        <p className="mt-2 text-sm text-ink-muted">
          This merchant has a paid subscription.
        </p>
      )}
      {!canManage && (
        <p className="mt-2 text-sm text-ink-muted">
          You have read-only access.
        </p>
      )}
    </div>
  );
}
