import Image from "next/image";
import { appInstallContent, playStoreUrl } from "@/content/site";

export function PlayStoreBadge({ slot, className = "" }: {
  slot: string; className?: string;
}) {
  return (
    <div className={`max-w-xs ${className}`}>
      <a href={playStoreUrl(slot)} className="inline-flex rounded-lg p-5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
        <Image src="/app/google-play-badge.png" alt={appInstallContent.badgeAlt} width={646} height={250} className="h-auto w-[180px]" />
      </a>
    </div>
  );
}
