"use client";

import { useId, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useDialogA11y } from "@/hooks/useDialogA11y";

/**
 * Shared bottom-sheet chrome (bottom sheet on mobile, centered modal on
 * desktop) — lifted from ProfileQuickActions' sheet host and generalized so
 * each settings row can own a single-purpose sheet instead of one component
 * hosting several named sheets. Same `useDialogA11y` behavior (focus trap,
 * initial focus, Escape, scroll lock, focus return) as every other overlay
 * in the app.
 */
export function EditSheet({
  title,
  trigger,
  children,
}: {
  title: string;
  trigger: (open: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  const titleId = useId();
  const sheetRef = useDialogA11y<HTMLDivElement>(open, close);

  return (
    <>
      {trigger(() => setOpen(true))}
      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center sm:px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={close} />
          <div
            ref={sheetRef}
            tabIndex={-1}
            className="relative flex max-h-[85dvh] w-full flex-col rounded-t-3xl bg-akiba-paper focus:outline-none sm:max-w-md sm:rounded-3xl"
          >
            <div className="flex items-center justify-between px-5 pb-2 pt-4">
              <h2 id={titleId} className="font-sterling text-lg font-semibold text-akiba-ink">
                {title}
              </h2>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-akiba-line bg-white text-akiba-muted transition hover:text-akiba-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-6">
              {children(close)}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
