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
      <head>
        <meta
          name="talentapp:project_verification"
          content="e094ae0b48ee58b3234c34523a790c3717783115f8a5b7a6c816274bbe26ddfb4d5436e4e660643d522670fd6599f93cae09ef1d56594862ddec76ec888d919b"
        />
      </head>
      <body className={`${sterling.variable}`}>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
