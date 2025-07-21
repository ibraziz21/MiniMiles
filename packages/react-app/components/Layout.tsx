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
  const pathname = usePathname();
  const { getUserAddress } = useWeb3();

  /* MiniPay detection */
  const [isMiniPay, setIsMiniPay] = useState(false);
  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).ethereum?.isMiniPay) {
      setIsMiniPay(true);
    }
  }, []);

  /* load wallet */
  useEffect(() => { getUserAddress(); }, [getUserAddress]);

  /* membership flag */
  const { data: isMember, isFetched } = useMembership();

  /* helper paths */
  const isOnboarding = pathname.startsWith('/onboarding');
  const isClaim      = pathname.startsWith('/claim');

  /* redirect if new user */
  useEffect(() => {
    if (!isFetched) return;
    if (!isMember && !isOnboarding && !isClaim) {
      router.replace('/onboarding');
    }
  }, [isMember, isFetched, isOnboarding, isClaim, router]);

  /* wait for flag */
  if (!isFetched) return null;

  return (
    <div className="bg-gypsum overflow-hidden flex flex-col min-h-screen">
      {!isOnboarding && !isClaim && !isMiniPay && <Header />}

      <div className="flex-grow bg-app">
        {children}
      </div>

      {!isOnboarding && !isClaim && <Footer />}
    </div>
  );
};

export default Layout;
