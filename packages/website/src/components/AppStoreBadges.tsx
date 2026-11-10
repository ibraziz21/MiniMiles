import Image from "next/image";

export function AppStoreBadges({ slot, className = "", campaign }: {
  slot: string;
  className?: string;
  campaign?: string;
}) {
  function storeLink(store: "ios" | "android") {
    const params = campaign === undefined
      ? new URLSearchParams({ utm_source: "marketing", utm_medium: "web", utm_campaign: slot })
      : new URLSearchParams(campaign);
    params.set("store", store);
    return `/download?${params}`;
  }

  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      <a href={storeLink("ios")} className="inline-flex rounded-lg p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        <Image src="/app/app-store-badge.svg" alt="Download on the App Store" width={120} height={40} className="h-12 w-auto" unoptimized />
      </a>
      <a href={storeLink("android")} className="inline-flex rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        <Image src="/app/google-play-badge.png" alt="Get it on Google Play" width={646} height={250} className="h-auto w-[186px]" />
      </a>
    </div>
  );
}
