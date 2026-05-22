"use client";

import { useEffect, useState, useCallback } from "react";

/**
 * Polls /api/merchant/stats every 30s and returns the count of 'placed' orders.
 * Used to drive the sidebar badge and page title indicator.
 */
export function useNewOrdersBadge() {
  const [count, setCount] = useState(0);

  const fetchCount = useCallback(async () => {
    try {
      const res = await fetch("/api/merchant/stats");
      if (!res.ok) return;
      const data = await res.json();
      setCount(data.new_orders ?? 0);
    } catch {
      // silently ignore — badge is best-effort
    }
  }, []);

  useEffect(() => {
    fetchCount();
    const interval = setInterval(fetchCount, 30_000);
    return () => clearInterval(interval);
  }, [fetchCount]);

  return count;
}
