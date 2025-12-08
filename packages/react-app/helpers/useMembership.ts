// src/helpers/useMembership.ts
import { useQuery } from "@tanstack/react-query";
import { useWeb3 } from "@/contexts/useWeb3";

export function useMembership() {
  const { address } = useWeb3();
  const normalized = address ? address.toLowerCase() : null;

  return useQuery({
    queryKey: ["isMember", normalized],
    enabled: !!normalized,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!normalized) return false;

      const res = await fetch(`/api/users/${normalized}`);
      if (!res.ok) {
        console.error("[useMembership] /api/users error:", res.status);
        return false;
      }
      const { isMember } = await res.json();
      return !!isMember;
    },
  });
}
