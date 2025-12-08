// src/hooks/useBadges.ts
"use client";

import { useQuery } from "@tanstack/react-query";
import { useWeb3 } from "@/contexts/useWeb3";
import type { BadgeProgressPayload } from "@/helpers/badgeStats";

export function useBadges() {
  const { address } = useWeb3();

  return useQuery<BadgeProgressPayload & { ok: boolean }>({
    queryKey: ["badges", address?.toLowerCase()],
    enabled: !!address,
    staleTime: 30_000,
    queryFn: async () => {
      const res = await fetch(`/api/badges/${address}`);
      const json = await res.json();
      if (!res.ok || json.error || json.ok === false) {
        throw new Error(json.error || "Badges load failed");
      }
      return json;
    },
  });
}
