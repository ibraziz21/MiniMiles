import { HomeViewTracker } from "@/components/akiba/HomeViewTracker";
import { HomeIntentSearch } from "@/components/home/HomeIntentSearch";
import { IntentShortcuts } from "@/components/home/IntentShortcuts";
import { MerchantRail } from "@/components/home/MerchantRail";
import { LocationOptIn } from "@/components/home/LocationOptIn";
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

  return (
    <main className="mx-auto max-w-2xl px-4 pt-4 pb-2 sm:pt-8 sm:pb-4">
      <HomeViewTracker variant="visitor" />

      <div className="mb-4">
        <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">
          Find the best place to buy what you need.
        </h1>
      </div>

      <div className="mb-4">
        <HomeIntentSearch placeholder="Search merchants or what you need…" />
      </div>

      <IntentShortcuts intents={feed.intents} title="Browse by need" />

      {forYou && <MerchantRail section={forYou} seeAllHref="/merchants" />}

      <LocationOptIn cities={cities} />

      {limitedTime && <MerchantRail section={limitedTime} seeAllHref="/vouchers" />}
    </main>
  );
}
