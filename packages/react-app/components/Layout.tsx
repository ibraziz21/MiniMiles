'use client'

import { FC, ReactNode } from "react";
import Footer from "./Footer";
import Header from "./Header";
import { usePathname } from "next/navigation";

interface Props {
    children: ReactNode;
}
const Layout: FC<Props> = ({ children }) => {
    const pathname = usePathname();

    const isOnboarding = pathname.startsWith("/onboarding");
    const isClaim = pathname.startsWith("/claim");
    return (
        <>
            <div className="bg-gypsum overflow-hidden flex flex-col min-h-screen">
                {!isOnboarding && !isClaim && <Header />}
                <div className="">
                    {children}
                </div>
                {!isOnboarding && !isClaim && <Footer />}
            </div>
        </>
    );
};

export default Layout;
