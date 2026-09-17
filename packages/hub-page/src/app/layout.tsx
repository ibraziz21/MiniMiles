import type { Metadata } from "next";
import localFont from "next/font/local";
import { DM_Sans, Poppins } from "next/font/google";
import { GoogleAnalytics } from "@next/third-parties/google";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { BottomNav } from "@/components/NavLinks";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";
import { InstallPrompt } from "@/components/InstallPrompt";
import { PushResubscribe } from "@/components/PushResubscribe";
import { PushOptInPrompt } from "@/components/PushOptInPrompt";

const gaMeasurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;

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

// Replaces globals.css's old render-blocking `@import url(fonts.googleapis...)`
// with a self-hosted, preloaded next/font load (automatic font-display,
// no extra render-blocking request).
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-dm-sans",
  display: "swap",
});

// Used throughout @akiba/skill-games (game-header, game-intro-sheet,
// game-result-sheet, masteryCopy — 8+ call sites via the `font-poppins`
// Tailwind utility) but was never actually loaded anywhere, so every game
// screen was silently rendering in the browser's fallback sans-serif.
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://pass.akibamiles.com";

export const viewport = {
  themeColor: "#238D9D",
  viewportFit: "cover" as const,
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Akiba Pass | Earn Miles, Vouchers & Rewards",
  description: "Earn AkibaMiles at participating merchants, then use your Miles for vouchers and rewards.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Akiba",
  },
  openGraph: {
    title: "Akiba Pass | Earn Miles, Vouchers & Rewards",
    description: "Earn AkibaMiles at participating merchants, then use your Miles for vouchers and rewards.",
    url: siteUrl, siteName: "Akiba Pass", locale: "en_US", type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sterling.variable} ${dmSans.variable} ${poppins.variable}`}>
      <body className="bg-akiba-paper text-akiba-ink antialiased">
        <ServiceWorkerRegister />
        <PushResubscribe />
        <SiteHeader />
        <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] sm:pb-0">{children}</div>
        <BottomNav />
        <InstallPrompt />
        <PushOptInPrompt />
        {gaMeasurementId && <GoogleAnalytics gaId={gaMeasurementId} />}
      </body>
    </html>
  );
}
