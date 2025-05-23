// components/ClientGate.tsx
"use client";

import { ReactNode, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useWeb3 } from "@/contexts/useWeb3";

export function ClientGate({ children }: { children: ReactNode }) {
  const { address, getUserAddress } = useWeb3();
  const router = useRouter();
  const path = usePathname();

  const [checked, setChecked] = useState(false);

  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  useEffect(() => {
    if (!address || checked) return;
    setChecked(true);

    // don’t reroute if already on onboarding
    if (path === "/onboarding") return;

    fetch(`/api/users/${address}`)
      .then((r) => r.json())
      .then(({ isMember }) => {
        if (!isMember) {
          router.replace("/onboarding");
        }
      })
      .catch((_) => {
        // on error, treat as new user
        router.replace("/onboarding");
      });
  }, [address, checked, path, router]);

  // don't render children until we’ve checked
  if (!checked) return null;
  return <>{children}</>;
}
