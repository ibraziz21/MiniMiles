// useHistoryBundle.ts
'use client';
import { useQuery } from '@tanstack/react-query';
import { useWeb3 } from '@/contexts/useWeb3';
import type { HistoryBundle, RaffleResultItem } from '@/types/history';

export function useHistoryBundle() {
  const { address } = useWeb3();
  return useQuery<HistoryBundle & { ok: boolean; raffleResults: RaffleResultItem[]; meta: any }>({
    queryKey: ['historyBundle', address?.toLowerCase()],
    enabled: !!address,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/history/${address}`);
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error || 'History load failed');
      }
      return json;
    }
  });
}
