"use client";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useMembership } from "@/helpers/useMembership";

interface Props {
  address?: string | null;
  children: React.ReactNode;
  exemptPaths?: string[];
}

export function MemberGate({ address, children, exemptPaths = ["/onboarding"] }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const justJoined = search.get("justJoined") === "1";
  const { isMember, loading, error } = useMembership(address);

  const exempt = exemptPaths.some(p => pathname.startsWith(p));

  // Redirect only after we *know* they are not a member
  useEffect(() => {
    if (!loading && !exempt && !justJoined && isMember === false && address) {
      router.replace("/onboarding");
    }
  }, [loading, isMember, exempt, justJoined, address, router]);

   useEffect(() => {
       if (justJoined && isMember === true) {
        router.replace("/", { scroll: false });
       }
     }, [justJoined, isMember, router]);

  if (exempt) return <>{children}</>;

  if (!address) {
    return (
      <div className="p-6 text-sm text-gray-600">
        Connect wallet to continue…
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6 animate-pulse text-sm text-gray-600">
        Checking membership…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-sm">
        <p className="text-red-600 mb-2">{error}</p>
        <button
          className="px-4 py-2 rounded bg-[#238D9D] text-white"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  // If they are NOT member, we are already redirecting — brief placeholder:
  if (isMember === false) {
    return <div className="p-6 text-sm text-gray-600">Redirecting…</div>;
  }

  return <>{children}</>;
}
