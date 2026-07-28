"use client";

// Shared live-rotating-token lifecycle — extracted from AkibaPassCard.tsx.
// The live token (~5 min expiry) is preferred; the durable static pass ID
// (via qrPayload) is the offline fallback. A photographed live code is
// useless minutes later, so till moments always try live first.
import { useCallback, useEffect, useState } from "react";
import { qrPayload } from "@/lib/akiba/passQr";

export function useLivePassToken(passId: string) {
  const [liveToken, setLiveToken] = useState<string | null>(null);
  const [liveExpiresAt, setLiveExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  const fetchLiveToken = useCallback(async () => {
    try {
      const res = await fetch("/api/me/pass/token", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const { token, expiresAt } = (await res.json()) as { token: string; expiresAt?: string };
      setLiveToken(token);
      setLiveExpiresAt(expiresAt ? new Date(expiresAt).getTime() : Date.now() + 300_000);
    } catch {
      // Offline or Platform down — static pass keeps working
      setLiveToken(null);
      setLiveExpiresAt(null);
    }
  }, []);

  // Initial fetch + refresh when the tab regains focus (till moment)
  useEffect(() => {
    void fetchLiveToken();
    const onVisible = () => {
      if (document.visibilityState === "visible") void fetchLiveToken();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchLiveToken]);

  // Countdown + auto-refresh 30s before expiry
  useEffect(() => {
    if (!liveExpiresAt) { setSecondsLeft(null); return; }
    const tick = () => {
      const left = Math.max(0, Math.floor((liveExpiresAt - Date.now()) / 1000));
      setSecondsLeft(left);
      if (left <= 30) void fetchLiveToken();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [liveExpiresAt, fetchLiveToken]);

  const currentPayload = liveToken ?? qrPayload(passId);

  return { liveToken, secondsLeft, currentPayload };
}
