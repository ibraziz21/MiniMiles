'use client'

import { FC, ReactNode, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Footer from "./Footer";
import Header from "./Header";
import { useWeb3 } from "@/contexts/useWeb3";

interface Props {
  children: ReactNode;
}

const Layout: FC<Props> = ({ children }) => {
  const router = useRouter();
  const pathname = usePathname();
  const { address, getUserAddress } = useWeb3();

  const [isMiniPay, setIsMiniPay] = useState(false);
  const [hasCheckedMember, setHasCheckedMember] = useState(false);

  // 1) Detect MiniPay host
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).ethereum?.isMiniPay) {
      setIsMiniPay(true);
    }
  }, []);

  // 2) Ensure we load the wallet address
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  // 3) Once we have an address, check membership
  useEffect(() => {
    if (!address || hasCheckedMember) return;
    setHasCheckedMember(true);

    // Don’t redirect if already on onboarding
    if (pathname.startsWith("/onboarding")) {
      return;
    }

    fetch(`/api/users/${address}`)
      .then((res) => res.json())
      .then(({ isMember }) => {
        if (!isMember) {
          router.replace("/onboarding");
        }
      })
      .catch(() => {
        // network or 404 => treat as new
        router.replace("/onboarding");
      });
  }, [address, hasCheckedMember, pathname, router]);

  const isOnboarding = pathname.startsWith("/onboarding");
  const isClaim = pathname.startsWith("/claim");
  const check = true;

  // 4) If we haven’t even checked membership yet, render nothing
  if (!check) {
    return null;
  }

  return (
    <div className="bg-gypsum overflow-hidden flex flex-col min-h-screen">
      {/* only show Header when not onboarding/claim AND not in MiniPay */}
      {!isOnboarding && !isClaim && !isMiniPay && <Header />}

      <div className="flex-grow">
        {children}
      </div>

      {/* Footer still shown except on onboarding/claim */}
      {!isOnboarding && !isClaim && <Footer />}
    </div>
  );
};

export default Layout;
