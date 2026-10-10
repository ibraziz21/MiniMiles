"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { isDirty } from "@/lib/dirty-state";

export function UpdateAvailableToast() {
  const waitingWorkerRef = useRef<ServiceWorker | null>(null);
  const shownRef = useRef(false);
  const skipWaitingRequestedRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

    function showToast(worker: ServiceWorker) {
      if (shownRef.current) return;
      shownRef.current = true;
      waitingWorkerRef.current = worker;

      toast("Update available", {
        description: "A new version of AkibaMiles Admin is ready.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            if (isDirty()) {
              toast.warning("Finish or discard your unsaved changes before reloading.");
              return;
            }
            skipWaitingRequestedRef.current = true;
            waitingWorkerRef.current?.postMessage({ type: "SKIP_WAITING" });
          },
        },
      });
    }

    navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) return;

      if (registration.waiting) showToast(registration.waiting);

      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            showToast(installing);
          }
        });
      });
    });

    let reloaded = false;
    function handleControllerChange() {
      // Ignore controllerchange from the browser's own first-ever claim
      // (no update happened, nothing to reload for) — only the user's own
      // explicit Reload click should ever trigger a page reload here.
      if (!skipWaitingRequestedRef.current || reloaded) return;
      reloaded = true;
      window.location.reload();
    }
    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);
    return () => navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
  }, []);

  return null;
}
