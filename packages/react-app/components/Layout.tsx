'use client'

import { FC, ReactNode, useEffect, useState } from "react";
import Footer from "./Footer";
import Header from "./Header";
import { usePathname } from "next/navigation";

interface Props {
  children: ReactNode;
}

const Layout: FC<Props> = ({ children }) => {
  const pathname = usePathname();
  const [isMiniPay, setIsMiniPay] = useState(false);

  // detect MiniPay host
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).ethereum?.isMiniPay) {
      setIsMiniPay(true);
    }
  }, []);

  const isOnboarding = pathname.startsWith("/onboarding");
  const isClaim = pathname.startsWith("/claim");

  return (
    <div className="bg-gypsum overflow-hidden flex flex-col min-h-screen">
      {/* only show header when not onboarding/claim AND not in MiniPay */}
      {!isOnboarding && !isClaim && !isMiniPay && <Header />}

      <div className="flex-grow">
        {children}
      </div>

      {/* footer still shown, remove !isMiniPay if you want to hide it too */}
      {!isOnboarding && !isClaim && <Footer />}
    </div>
  );
};

export default Layout;
