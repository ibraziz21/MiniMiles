import { playStoreUrl } from "@/constants/links";
import { TrackedAnchor } from "@/components/TrackedAnchor";

export function PlayStoreLink({ slot }: { slot: string }) {
  return <TrackedAnchor href={playStoreUrl(slot)} event="app_install_tap" eventProps={{ slot }} className="mb-4 flex min-h-11 items-center justify-between gap-2 rounded-xl bg-akiba-tint px-3.5 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal">
    <span className="text-akiba-ink">Discover places and offers with Akiba for Android. Available in Kenya.</span>
    <span className="shrink-0 font-semibold text-akiba-teal">Google Play →</span>
  </TrackedAnchor>;
}
