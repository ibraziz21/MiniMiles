"use client";
import { useEffect, useState, useCallback } from "react";

export function useMembership(address?: string | null) {
  const [isMember, setIsMember] = useState<boolean | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);

  const fetchFlag = useCallback(async (addr: string) => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/users/${addr}`);
      const j = await r.json();
      setIsMember(!!j.isMember);
    } catch {
      setError("Failed to fetch membership");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setIsMember(null);
      return;
    }
    fetchFlag(address);
  }, [address, fetchFlag]);

  const refetch = useCallback(() => {
    if (address) fetchFlag(address);
  }, [address, fetchFlag]);

  return { isMember, loading, error, refetch };
}
