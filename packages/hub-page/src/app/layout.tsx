import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { BottomNav } from "@/components/NavLinks";
import { CartProvider } from "@/lib/cart";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

const sterling = localFont({
  src: [
    { path: "../../public/fonts/sterling/FTSterlingTrial-Light.woff", weight: "300", style: "normal" },
    { path: "../../public/fonts/sterling/FTSterlingTrial-Regular.woff", weight: "400", style: "normal" },
    { path: "../../public/fonts/sterling/FTSterlingTrial-Medium.woff", weight: "500", style: "normal" },
    { path: "../../public/fonts/sterling/FTSterlingTrial-Semi-Bold.woff", weight: "600", style: "normal" },
    { path: "../../public/fonts/sterling/FTSterlingTrial-Bold.woff", weight: "700", style: "normal" },
  ],
  variable: "--font-sterling",
});

const siteUrl = "https://hub.akibamiles.com";

export const viewport = {
  themeColor: "#238D9D",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Akiba Hub | Shop, Earn, Rewards & Quests",
  description: "Shop from merchants, earn AkibaMiles, claim rewards, and complete quests.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Akiba",
  },
  openGraph: {
    title: "Akiba Hub | Shop, Earn, Rewards & Quests",
    description: "Shop from merchants, earn AkibaMiles, claim rewards, and complete quests.",
    url: siteUrl, siteName: "Akiba Hub", locale: "en_US", type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sterling.variable}>
      <body className="bg-akiba-paper text-akiba-ink antialiased">
        <CartProvider>
          <ServiceWorkerRegister />
          <SiteHeader />
          <div className="pb-16 sm:pb-0">{children}</div>
          <BottomNav />
        </CartProvider>
      </body>
    </html>
  );
}
