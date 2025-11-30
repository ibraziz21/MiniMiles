'use client';

import { FC, ReactNode, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Footer from './Footer';
import Header from './Header';
import { useWeb3 } from '@/contexts/useWeb3';
import { useMembership } from '@/helpers/useMembership';

interface Props { children: ReactNode }

const Layout: FC<Props> = ({ children }) => {
  const router   = useRouter();
  const pathname = usePathname() || '/';
  const { getUserAddress } = useWeb3();

  /* MiniPay detection */
  const [isMiniPay, setIsMiniPay] = useState<boolean | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mp = !!(window as any).ethereum?.isMiniPay;
    console.log('[Layout] MiniPay detected?', mp);
    setIsMiniPay(mp);
  }, []);

  /* load wallet (safe on desktop too — it will just fail gracefully if no wallet) */
  useEffect(() => {
    (async () => {
      try {
        console.log('[Layout] calling getUserAddress()');
        await getUserAddress();
      } catch (err) {
        console.warn('[Layout] getUserAddress error:', err);
      }
    })();
  }, [getUserAddress]);

  /* membership flag */
  const { data: isMember, isFetched, isError } = useMembership();
  console.log('[Layout] membership state', { isMember, isFetched, isError });

  /* helper paths */
  const isOnboarding = pathname.startsWith('/onboarding');
  const isClaim      = pathname.startsWith('/claim');

  /* redirect if new user – **ONLY inside MiniPay** */
  useEffect(() => {
    if (isMiniPay !== true) {
      // On desktop / non-MiniPay we do NOT gate by membership.
      return;
    }

    if (!isFetched) return;

    console.log('[Layout] MiniPay env, membership fetched', {
      isMember,
      isOnboarding,
      isClaim,
    });

    if (!isMember && !isOnboarding && !isClaim) {
      console.log('[Layout] redirecting non-member in MiniPay -> /onboarding');
      router.replace('/onboarding');
    }
  }, [isMiniPay, isFetched, isMember, isOnboarding, isClaim, router]);

  /* while still detecting MiniPay, avoid flicker */
  if (isMiniPay === null) {
    console.log('[Layout] waiting for MiniPay detection…');
    return null;
  }

  /* Only block on membership loading if we are actually in MiniPay */
  if (isMiniPay && !isFetched) {
    console.log('[Layout] MiniPay + membership not fetched yet → gating render');
    return null;
  }

  console.log('[Layout] rendering app', { isMiniPay, isOnboarding, isClaim });

  return (
    <div className="bg-gypsum overflow-hidden flex flex-col min-h-screen">
      {/* On desktop: show header on all non-onboarding/non-claim routes.
          Inside MiniPay: header is hidden (MiniPay handles chrome). */}
      {!isOnboarding && !isClaim && !isMiniPay && <Header />}

      <div className="flex-grow bg-app">
        {children}
      </div>

      {/* Footer should show everywhere except onboarding/claim, even in MiniPay */}
      {!isOnboarding && !isClaim && <Footer />}
    </div>
  );
};

export default Layout;
