import { HomeViewTracker } from "@/components/akiba/HomeViewTracker";
import { DiscoveryMasthead } from "@/components/home/DiscoveryMasthead";
import { IntentShortcuts } from "@/components/home/IntentShortcuts";
import { MerchantRail } from "@/components/home/MerchantRail";
import { LocationOptIn } from "@/components/home/LocationOptIn";
import { VoucherRail } from "@/components/home/VoucherRail";
import { getHomeFeed } from "@/lib/home/feed";
import { listDirectoryCities } from "@/lib/merchants/queries";

// Signed-out home — home-redesign-spec.md §5. Same discovery mental model as
// the member home (full public search, no sign-up wall on browsing), not a
// separate marketing pitch. Sign-in is required only when a protected action
// (e.g. acquiring a voucher) needs it.
export async function VisitorLanding() {
  const [feed, cities] = await Promise.all([
    getHomeFeed({ userId: null }),
    listDirectoryCities().catch(() => [] as string[]),
  ]);

  const forYou = feed.sections.find((s) => s.id === "for_you") ?? null;
  const limitedTime = feed.sections.find((s) => s.id === "limited_time") ?? null;
  const newMerchants = feed.sections.find((s) => s.id === "new") ?? null;
  const voucherMerchants = [
    ...(limitedTime?.merchants ?? []),
    ...(forYou?.merchants ?? []),
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 pb-3 pt-4 sm:px-6 sm:pb-6 sm:pt-8 lg:px-8">
      <HomeViewTracker variant="visitor" />

      <DiscoveryMasthead />

      <IntentShortcuts intents={feed.intents} title="What are you looking for?" />

      <VoucherRail merchants={voucherMerchants} />

      {forYou && (
        <MerchantRail
          section={forYou}
          seeAllHref="/merchants"
          description="Browse places to shop, both nearby and online."
        />
      )}

      <LocationOptIn cities={cities} />

      {newMerchants && <MerchantRail section={newMerchants} seeAllHref="/merchants" />}
    </main>
  );
}
