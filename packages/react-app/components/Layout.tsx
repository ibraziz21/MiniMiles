'use client';

import { FC, ReactNode, Suspense, useEffect, useState } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import Footer from './Footer';
import Header from './Header';
import { useWeb3 } from '@/contexts/useWeb3';
import { useMembership } from '@/helpers/useMembership';

interface Props { children: ReactNode }

const LayoutContent: FC<Props> = ({ children }) => {
  const router   = useRouter();
  const pathname = usePathname() || '/';
  const searchParams = useSearchParams();
  const { getUserAddress } = useWeb3();
  const isPromoCapture = searchParams.get('akibaPromoCapture') === '1';

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
    if (isPromoCapture || isMiniPay !== true) {
      // On desktop / non-MiniPay we do NOT gate by membership.
      return;
    }

    if (!isFetched) return;

    console.log('[Layout] MiniPay env, membership fetched', {
      isMember,
      isOnboarding,
      isClaim,
    });

    // Don't redirect if the membership check itself errored (e.g. Supabase timeout).
    // A DB failure is not proof the user isn't a member.
    if (!isMember && !isError && !isOnboarding && !isClaim) {
      console.log('[Layout] redirecting non-member in MiniPay -> /onboarding');
      router.replace('/onboarding');
    }
  }, [isPromoCapture, isMiniPay, isFetched, isMember, isError, isOnboarding, isClaim, router]);

  /* while still detecting MiniPay, avoid flicker */
  if (!isPromoCapture && isMiniPay === null) {
    console.log('[Layout] waiting for MiniPay detection…');
    return null;
  }

  /* Only block on membership loading if we are actually in MiniPay */
  if (!isPromoCapture && isMiniPay && !isFetched) {
    console.log('[Layout] MiniPay + membership not fetched yet → gating render');
    return null;
  }

  const renderAsMiniPay = isPromoCapture || isMiniPay;
  console.log('[Layout] rendering app', { isMiniPay: renderAsMiniPay, isOnboarding, isClaim });

  return (
    <div className="bg-gypsum overflow-hidden flex flex-col min-h-screen">
      {/* On desktop: show header on all non-onboarding/non-claim routes.
          Inside MiniPay: header is hidden (MiniPay handles chrome). */}
      {!isOnboarding && !isClaim && !renderAsMiniPay && <Header />}

      <div className="flex-grow bg-app">
        {children}
      </div>

      {/* Footer should show everywhere except onboarding/claim, even in MiniPay */}
      {!isOnboarding && !isClaim && <Footer />}
    </div>
  );
};

const Layout: FC<Props> = ({ children }) => (
  <Suspense fallback={null}>
    <LayoutContent>{children}</LayoutContent>
  </Suspense>
);

export default Layout;
