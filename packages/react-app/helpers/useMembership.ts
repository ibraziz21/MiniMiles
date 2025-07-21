import { useQuery } from "@tanstack/react-query";
import { useWeb3 } from "@/contexts/useWeb3";

export function useMembership() {
  const { address } = useWeb3();

  return useQuery({
    queryKey: ["isMember", address?.toLowerCase()],
    enabled: !!address,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const res = await fetch(`/api/users/${address}`);
      const { isMember } = await res.json();
      return !!isMember;
    },
  });
}
