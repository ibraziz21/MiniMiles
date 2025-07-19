/* --------------------------------------------------------------------------
 * components/MemberGate.tsx
 * Global membership guard – sessionStorage “justJoined” flag version
 * -------------------------------------------------------------------------- */
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useMembership } from "@/helpers/useMembership";

interface Props {
  address?: string | null;
  children: React.ReactNode;
  /** routes that never trigger a redirect */
  exemptPaths?: string[];
}

export function MemberGate({
  address,
  children,
  exemptPaths = ["/onboarding"],
}: Props) {
  const router               = useRouter();
  const pathname             = usePathname();
  const { isMember, loading, error } = useMembership(address);

  /* ---------- local flags ---------- */
  const [justJoined, setJustJoined]       = useState(false);
  const [suppressRedirect, setSuppressRedirect] = useState(true); // block redirects until first mount
  const mounted = useRef(false);

  const exempt = exemptPaths.some((p) => pathname.startsWith(p));

  /* ---------- read "justJoined" flag once (client only) ---------- */
  useEffect(() => {
    mounted.current = true;
    try {
      if (typeof window !== "undefined" && sessionStorage.getItem("justJoined") === "1") {
        setJustJoined(true);
      }
    } catch {
      /* ignore private-mode or disabled storage */
    }
  }, []);

  /* ---------- allow redirect only after first membership result ---------- */
  useEffect(() => {
    if (!mounted.current) return;
    if (!loading) {
      // defer one micro-task so justJoined state is set
      const t = setTimeout(() => setSuppressRedirect(false), 0);
      return () => clearTimeout(t);
    }
  }, [loading]);

  /* ---------- redirect logic ---------- */
  useEffect(() => {
    if (
      !suppressRedirect &&      // guard released
      !exempt &&                // not on onboarding/claim
      isMember === false &&     // definitely not a member
      address &&                // have wallet
      !justJoined               // not fresh join
    ) {
      router.replace("/onboarding");
    }
  }, [suppressRedirect, exempt, isMember, address, justJoined, router]);

  /* ---------- clear flag after confirmed ---------- */
  useEffect(() => {
    if (justJoined && isMember === true) {
      try {
        sessionStorage.removeItem("justJoined");
      } catch {}
      setJustJoined(false); // no longer needed
    }
  }, [justJoined, isMember]);

  /* ---------- render states ---------- */
  if (exempt) return <>{children}</>;

  if (!address) {
    return (
      <div className="p-6 text-sm text-gray-600">
        Connect wallet to continue…
      </div>
    );
  }

  if (loading || suppressRedirect) {
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

  if (isMember === false && !justJoined) {
    // redirect effect will fire; placeholder splash
    return <div className="p-6 text-sm text-gray-600">Redirecting…</div>;
  }

  return <>{children}</>;
}
