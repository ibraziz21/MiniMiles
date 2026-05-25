import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { siteConfig } from "@/content/site";

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

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.siteUrl),
  title: {
    default: siteConfig.title,
    template: "%s | AkibaMiles",
  },
  description: siteConfig.description,
  openGraph: {
    title: siteConfig.title,
    description: siteConfig.description,
    url: siteConfig.siteUrl,
    siteName: siteConfig.name,
    images: [
      {
        url: "/webflow/opengraph.jpg",
        width: 1200,
        height: 630,
        alt: "AkibaMiles rewards ecosystem",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: siteConfig.title,
    description: siteConfig.description,
    images: ["/webflow/opengraph.jpg"],
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sterling.variable} font-sans antialiased`}>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
