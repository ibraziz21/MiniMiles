'use client';

import { FC, ReactNode, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Footer from "./Footer";
import Header from "./Header";
import { useWeb3 } from "@/contexts/useWeb3";
import { MemberGate } from "@/components/memberGate";

/**
 * Routes that should NOT trigger membership redirect.
 * Add others (e.g. marketing pages) as needed.
 */
const EXEMPT_PATHS = ["/onboarding", "/claim"];

interface Props {
  children: ReactNode;
}

const Layout: FC<Props> = ({ children }) => {
  const pathname = usePathname();
  const { address, getUserAddress } = useWeb3();

  const [isMiniPay, setIsMiniPay] = useState(false);

  // Detect MiniPay host
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).ethereum?.isMiniPay) {
      setIsMiniPay(true);
    }
  }, []);

  // Ensure we attempt to load wallet address once
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  const isOnboarding = pathname.startsWith("/onboarding");
  const isClaim = pathname.startsWith("/claim");

  return (
    <div className="bg-gypsum overflow-hidden flex flex-col min-h-screen">
      {/* Hide header on onboarding / claim or when in MiniPay host (if desired) */}
      {!isOnboarding && !isClaim && !isMiniPay && <Header />}

      <div className="flex-grow bg-app">
        <MemberGate
          address={address}
          exemptPaths={EXEMPT_PATHS}
        >
          {children}
        </MemberGate>
      </div>

      {!isOnboarding && !isClaim && <Footer />}
    </div>
  );
};

export default Layout;
