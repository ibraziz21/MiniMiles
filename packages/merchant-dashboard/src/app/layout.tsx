import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AkibaMiles Merchant Portal",
  description: "Manage your AkibaMiles orders, catalog, vouchers, and fulfillment",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
