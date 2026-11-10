import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/ButtonLink";
import { Panel } from "@/components/Panel";
import { PhoneFrame } from "@/components/PhoneFrame";
import { siteConfig } from "@/content/site";
import { AppStoreBadges } from "@/components/AppStoreBadges";
import { downloadCampaign } from "@/lib/download";

export const metadata: Metadata = {
  title: "Download Akiba",
  description: "Find local places in Kenya, discover offers and collect AkibaMiles. Download Akiba for iPhone or Android.",
  alternates: { canonical: "/download/options" },
};

export default function DownloadOptions({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const incoming = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") incoming.set(key, value);
  }
  const campaign = downloadCampaign(incoming);

  return (
    <main>
      <Panel tone="tint">
        <div className="grid items-center gap-12 lg:grid-cols-[1.3fr_0.7fr]">
          <div className="max-w-xl">
            <h1 className="font-sterling text-4xl font-medium leading-tight text-akiba-ink sm:text-6xl">
              Your next good place is on Akiba.
            </h1>
            <p className="mt-6 text-lg leading-8 text-akiba-muted">
              Find shops and cafés in Kenya, discover their offers and collect Miles on eligible purchases.
            </p>
            <AppStoreBadges slot="download" campaign={campaign.toString()} className="mt-8" />
            <p className="mt-5 text-sm text-akiba-muted">Available in Kenya for iPhone and Android.</p>
            <div className="mt-10 flex items-center gap-5 border-t border-akiba-line pt-6">
              <Image src="/app/download-qr.svg" alt="Scan to download Akiba on your phone" width={112} height={112} unoptimized />
              <p className="max-w-48 text-sm leading-6 text-akiba-muted">On a computer? Scan this code with your phone to get Akiba.</p>
            </div>
            <div className="mt-6">
              <ButtonLink href={siteConfig.passUrl} variant="ghost">Open Akiba in your browser</ButtonLink>
            </div>
          </div>
          <PhoneFrame src="/app/explore.webp" alt="Explore local places and offers in Akiba" priority className="mx-auto" />
        </div>
      </Panel>
    </main>
  );
}
