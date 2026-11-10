"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, ChevronRight, X } from "lucide-react";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@/components/ui/dialog";
import type { AttentionItem } from "@/components/ui/attention-card";

export function AttentionInbox({ items }: { items: AttentionItem[] }) {
  const [open, setOpen] = useState(false);
  const pending = items.reduce(
    (sum, item) => sum + (item.unavailable ? 0 : item.count),
    0
  );
  const unavailable = items.some((item) => item.unavailable);
  const visible = items.filter((item) => item.count > 0 || item.unavailable);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={`Needs attention, ${pending} pending${
            unavailable ? ", some queues unavailable" : ""
          }`}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
          {(pending > 0 || unavailable) && (
            <span
              aria-hidden="true"
              className="absolute right-0 top-0 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-[11px] font-semibold leading-none text-white"
            >
              {unavailable ? "!" : pending > 99 ? "99+" : pending}
            </span>
          )}
        </button>
      </DialogTrigger>
      <DialogContent
        hideClose
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto overscroll-contain p-4 sm:p-5"
      >
        <div className="flex items-center justify-between gap-3">
          <DialogTitle>Needs attention</DialogTitle>
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close attention inbox"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </DialogClose>
        </div>
        <DialogDescription className="mt-1">
          {unavailable
            ? "Some queues couldn’t be loaded."
            : pending > 0
            ? `${pending} pending review${pending === 1 ? "" : "s"}`
            : "Nothing needs attention right now."}
        </DialogDescription>
        {visible.length > 0 && (
          <ul className="mt-4 divide-y divide-border">
            {visible.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/ops-queue?type=${encodeURIComponent(item.id)}`}
                  onClick={() => setOpen(false)}
                  className="flex min-h-14 items-center gap-3 rounded-control py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:bg-surface-subtle"
                >
                  <span className="min-w-0 flex-1 text-sm font-medium text-ink">
                    {item.label}
                  </span>
                  <span className="text-sm tabular-nums text-ink-muted">
                    {item.unavailable ? "Unavailable" : item.count}
                  </span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-ink-muted"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/ops-queue"
          onClick={() => setOpen(false)}
          className="mt-4 flex min-h-11 items-center justify-center gap-2 rounded-control bg-primary px-4 text-sm font-medium text-white hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          View queue
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </DialogContent>
    </Dialog>
  );
}
