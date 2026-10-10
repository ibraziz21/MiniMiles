"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { OfflineState } from "@/components/ui/offline-state";

export function ConnectionStatus() {
  const queryClient = useQueryClient();
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    setIsOnline(navigator.onLine);

    function handleOnline() {
      setIsOnline(true);
      // Reconnect refetches the currently-visible queries rather than reloading
      // the page or replaying any mutation (spec §11.3 — never auto-replay a mutation).
      void queryClient.invalidateQueries();
    }
    function handleOffline() {
      setIsOnline(false);
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [queryClient]);

  if (isOnline) return null;

  return (
    <div className="px-4 pt-3 sm:px-6">
      <OfflineState />
    </div>
  );
}
