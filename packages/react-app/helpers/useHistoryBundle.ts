'use client';
import { useQuery } from '@tanstack/react-query';
import { useWeb3 } from '@/contexts/useWeb3';
import type { HistoryBundle } from '@/types/history';

export function useHistoryBundle() {
  const { address } = useWeb3();

  return useQuery<HistoryBundle>({
    queryKey: ['historyBundle', address?.toLowerCase()],
    enabled: !!address,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/history/${address}`);
      const text = await res.text();
      let json: any = {};
      try { json = text ? JSON.parse(text) : {}; } catch {
        throw new Error(`History invalid JSON: ${text.slice(0,160)}`);
      }
      if (!res.ok || json.error) {
        throw new Error(
          `History ${res.status}: ${json.error || 'Unknown'} ${
            json.detail ? '→ ' + JSON.stringify(json.detail) : ''
          }`
        );
      }
      return json;
    },
  });
}
