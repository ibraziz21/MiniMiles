// src/hooks/useStreakQuests.ts
import { useState, useCallback } from "react";

type ApiResult = {
  success: boolean;
  code?: string;
  message?: string;
  txHash?: string;
  scopeKey?: string;
  claimedAt?: string;
};

async function postJson<T>(url: string, body: any): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return res.json();
}

function useClaim(path: string) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = useCallback(
    async (payload: any) => {
      setLoading(true);
      setError(null);
      try {
        const data = await postJson<ApiResult>(path, payload);
        setResult(data);
        if (!data.success && data.message) setError(data.message);
        return data;
      } catch (e: any) {
        console.error("[useClaim]", e);
        const msg = e?.message ?? "Request failed";
        setError(msg);
        const fallback: ApiResult = { success: false, message: msg };
        setResult(fallback);
        return fallback;
      } finally {
        setLoading(false);
      }
    },
    [path]
  );

  return { claim, loading, result, error };
}

/* ───────────────────── specific streaks ───────────────────── */

export function useTopupStreakQuest() {
  return useClaim("/api/streaks/topup");
}

export function useWalletStreakQuest() {
  return useClaim("/api/streaks/balances");
}

export function useGamesStreakQuest() {
  return useClaim("/api/streaks/games");
}
