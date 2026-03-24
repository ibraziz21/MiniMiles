import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AkibaMiles Analytics",
  description: "Analytics dashboard for AkibaMiles crypto rewards app",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-900 text-gray-100 min-h-screen">
        {children}
      </body>
    </html>
  );
}
