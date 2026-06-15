import { AppBanner } from "@/components/AppBanner";
import { DiscoveryFeed } from "@/components/DiscoveryFeed";
import { PartnerStrip } from "@/components/PartnerStrip";

export default function HubPage() {
  return (
    <main>
      <AppBanner />
      <DiscoveryFeed />
      <PartnerStrip />
    </main>
  );
}
