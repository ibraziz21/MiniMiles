"use client";

import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Shared behavior for hand-rolled dialogs/sheets — every overlay in this app
 * (WalletPickerModal, ProfileQuickActions, CartDrawer, ...) has its own
 * bespoke visual chrome, so this is a hook rather than a wrapping component:
 * it only standardizes the behavior each one was independently missing —
 * focus trap, initial focus, body scroll lock, and focus return to the
 * trigger on close. Escape-to-close is opt-in via `onClose` — omit it for a
 * mandatory dialog (e.g. WalletPickerModal) that has no legitimate dismiss
 * action.
 *
 * Attach the returned ref to the dialog's outer content element.
 */
export function useDialogA11y<T extends HTMLElement>(open: boolean, onClose?: () => void) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!open) return;
    const triggerElement = document.activeElement as HTMLElement | null;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const container = containerRef.current;
    const initialFocusable = container?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (initialFocusable ?? container)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (onClose) {
          event.stopPropagation();
          onClose();
        }
        return;
      }
      if (event.key !== "Tab" || !container) return;

      const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null,
      );
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      triggerElement?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return containerRef;
}
