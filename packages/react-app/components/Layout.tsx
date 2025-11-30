'use client';

import { FC, ReactNode, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Footer from './Footer';
import Header from './Header';
import { useWeb3 } from '@/contexts/useWeb3';
import { useMembership } from '@/helpers/useMembership';

interface Props {
  children: ReactNode;
}

const Layout: FC<Props> = ({ children }) => {
  const router   = useRouter();
  const pathname = usePathname();
  const { address, getUserAddress } = useWeb3();

  /* MiniPay detection */
  const [isMiniPay, setIsMiniPay] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum?.isMiniPay) {
      setIsMiniPay(true);
    }
  }, []);

  /* load wallet (MiniPay / injected) */
  useEffect(() => {
    getUserAddress?.();
  }, [getUserAddress]);

  /* membership flag */
  const { data: isMember, isFetched } = useMembership();

  /* helper paths */
  const isOnboarding = pathname.startsWith('/onboarding');
  const isClaim      = pathname.startsWith('/claim');

  /**
   * We only want to *force* onboarding when:
   *  - we’re inside MiniPay (in-app flow), AND
   *  - we actually have a wallet address, AND
   *  - membership has finished loading.
   *
   * On desktop (no MiniPay) we let the user roam freely and only
   * gate on specific pages if you want, not globally here.
   */
  const shouldGateWithMembership = isMiniPay && !!address;

  useEffect(() => {
    if (!shouldGateWithMembership) return; // don’t gate desktop / no-address users
    if (!isFetched) return;

    if (!isMember && !isOnboarding && !isClaim) {
      router.replace('/onboarding');
    }
  }, [shouldGateWithMembership, isMember, isFetched, isOnboarding, isClaim, router]);

  /**
   * While membership is loading, only block rendering
   * when we’re actually gating (MiniPay + address).
   * On PC, just render normally.
   */
  if (shouldGateWithMembership && !isFetched) {
    return null;
  }

  return (
    <div className="bg-gypsum overflow-hidden flex flex-col min-h-screen">
      {/* In MiniPay you might want a tighter chrome; on desktop show header as usual */}
      {!isOnboarding && !isClaim && !isMiniPay && <Header />}

      <div className="flex-grow bg-app">
        {children}
      </div>

      {!isOnboarding && !isClaim && <Footer />}
    </div>
  );
};

export default Layout;
