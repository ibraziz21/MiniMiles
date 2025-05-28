import '@/styles/globals.css';
import "@/styles/style.css";
import localFont from "next/font/local";

import { AppProvider } from '@/providers/AppProvider';

const sterling = localFont({
  src: [
    {
      path: "../public/fonts/sterling/FTSterlingTrial-Light.woff",
      weight: "200",
    },
    {
      path: "../public/fonts/sterling/FTSterlingTrial-Regular.woff",
      weight: "300",
    },
    {
      path: "../public/fonts/sterling/FTSterlingTrial-Medium.woff",
      weight: "400",
    },
    {
      path: "../public/fonts/sterling/FTSterlingTrial-Semi-Bold.woff",
      weight: "500",
    },
    {
      path: "../public/fonts/sterling/FTSterlingTrial-Bold.woff",
      weight: "600",
    },
  ],
  variable: "--font-sterling",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sterling.variable}`}>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
