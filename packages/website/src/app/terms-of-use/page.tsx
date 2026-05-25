import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { termsOfUse } from "@/content/legal";

export const metadata: Metadata = {
  title: "Terms of Service",
  robots: {
    index: false,
    follow: true,
  },
};

export default function TermsOfUsePage() {
  return <LegalPage page={termsOfUse} />;
}
