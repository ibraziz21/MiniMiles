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
    retry: 2,
    queryFn: async () => {
      if (!normalized) return false;

      const res = await fetch(`/api/users/${normalized}`);
      if (!res.ok) {
        // Throw so React Query marks this as an error, not as "confirmed non-member".
        // Layout guards on isError to avoid redirecting to onboarding on DB failures.
        throw new Error(`[useMembership] /api/users ${res.status}`);
      }
      const { isMember } = await res.json();
      return !!isMember;
    },
  });
}
