"use client";

import { useQuery } from "@tanstack/react-query";
import type { MerchantQuestStatus } from "@/lib/merchantDiscoveryQuests";

export type MerchantQuestStatusResponse = {
  enabled: boolean;
  quests: MerchantQuestStatus[];
};

export function useMerchantQuestStatus(
  address?: string,
  isAuthenticated = false,
) {
  return useQuery<MerchantQuestStatusResponse>({
    enabled: !!address && isAuthenticated,
    queryKey: ["merchant-discovery-status", address, isAuthenticated],
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: address && isAuthenticated ? 30_000 : false,
    retry: false,
    queryFn: async () => {
      if (!address) return { enabled: false, quests: [] };
      const response = await fetch("/api/merchant-quests/status", {
        cache: "no-store",
      });
      if (response.status === 401) {
        return { enabled: false, quests: [] };
      }
      if (!response.ok) {
        throw new Error("Could not load merchant quest status");
      }
      const data = (await response.json()) as Partial<MerchantQuestStatusResponse>;
      return {
        enabled: data.enabled === true,
        quests: data.quests ?? [],
      };
    },
  });
}
