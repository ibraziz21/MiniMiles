import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';

// A failed refresh keeps the last successful content visible. A generation
// guards against responses arriving after a tab change or account switch.
export function useProfileResource<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(false);
    try { const next = await fetcher(); if (request === generation.current) setData(next); }
    catch { if (request === generation.current) setError(true); }
    finally { if (request === generation.current) setLoading(false); }
  }, [fetcher]);
  useFocusEffect(useCallback(() => { void reload(); return () => { generation.current += 1; }; }, [reload]));
  return { data, setData, loading, error, reload };
}
