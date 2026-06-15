import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SiteHeader } from "@/components/SiteHeader";
import { SiteFooter } from "@/components/SiteFooter";

const sterling = localFont({
  src: [
    {
      path: "../../public/fonts/sterling/FTSterlingTrial-Light.woff",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../public/fonts/sterling/FTSterlingTrial-Regular.woff",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/fonts/sterling/FTSterlingTrial-Medium.woff",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../public/fonts/sterling/FTSterlingTrial-Semi-Bold.woff",
      weight: "600",
      style: "normal",
    },
    {
      path: "../../public/fonts/sterling/FTSterlingTrial-Bold.woff",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-sterling",
});

const siteUrl = "https://hub.akibamiles.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Akiba Hub | Discover Rewards, Vouchers, Games and Campaigns",
  description:
    "Explore AkibaMiles rewards, MiniPay campaigns, Base rewards, partner quests, games, raffles, vouchers and merchant promos.",
  openGraph: {
    title: "Akiba Hub | Discover Rewards, Vouchers, Games and Campaigns",
    description:
      "Explore AkibaMiles rewards, MiniPay campaigns, Base rewards, partner quests, games, raffles, vouchers and merchant promos.",
    url: siteUrl,
    siteName: "Akiba Hub",
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Akiba Hub | Discover Rewards, Vouchers, Games and Campaigns",
    description:
      "Explore AkibaMiles rewards, MiniPay campaigns, Base rewards, partner quests, games, raffles, vouchers and merchant promos.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sterling.variable}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
