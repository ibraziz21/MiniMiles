import { TrackedLink } from "@/components/akiba/TrackedLink";
import { HomeViewTracker } from "@/components/akiba/HomeViewTracker";
import { DiscoveryMasthead } from "@/components/home/DiscoveryMasthead";
import { IntentShortcuts } from "@/components/home/IntentShortcuts";
import { MerchantRail } from "@/components/home/MerchantRail";
import { LocationOptIn } from "@/components/home/LocationOptIn";
import { VoucherRail } from "@/components/home/VoucherRail";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getHomeFeed } from "@/lib/home/feed";
import { listDirectoryCities } from "@/lib/merchants/queries";
import type { User } from "@supabase/supabase-js";

function daysUntilLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

// The intent-first member home — expressing a need through search or a
// shortcut is the first action, followed by vouchers and merchant discovery.
export async function MemberHome({ user }: { user: User }) {
  const email = user.email ?? null;

  const [{ displayName }, feed, cities] = await Promise.all([
    resolveHubProfile({ userId: user.id, email }),
    getHomeFeed({ userId: user.id, userEmail: email }),
    listDirectoryCities().catch(() => [] as string[]),
  ]);

  // displayName falls back to the raw email (resolveHubProfile) when the
  // member has set neither a full name nor a username — never surface that
  // as a "name" in the greeting.
  const firstName = displayName.includes("@") ? null : displayName.split(" ")[0] || displayName;
  const forYou = feed.sections.find((s) => s.id === "for_you") ?? null;
  const limitedTime = feed.sections.find((s) => s.id === "limited_time") ?? null;
  const newMerchants = feed.sections.find((s) => s.id === "new") ?? null;

  const continueVoucher = feed.rewards?.continueVoucher ?? null;
  const voucherMerchants = [
    ...(limitedTime?.merchants ?? []),
    ...(forYou?.merchants ?? []),
  ];

  return (
    <main className="mx-auto max-w-6xl px-4 pb-3 pt-4 sm:px-6 sm:pb-6 sm:pt-8 lg:px-8">
      <HomeViewTracker variant="member" />

      <DiscoveryMasthead firstName={firstName} milesBalance={feed.rewards?.milesBalance ?? null} />

      {/* Continue-this strip — at most one item, only when something's
          genuinely urgent (discovery-blueprint.md §3, workstream 7). A thin
          notification-style row, not a card, since it's a nudge back to
          something already in motion rather than a new discovery. */}
      {continueVoucher && (
        <TrackedLink
          href={`/merchants/${continueVoucher.merchantSlug}`}
          event="home_continue_voucher_tap"
          eventProps={{ merchant_id: continueVoucher.merchantSlug }}
          className="mb-4 flex items-center justify-between gap-2 rounded-xl bg-akiba-tint px-3.5 py-2.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
        >
          <span className="text-akiba-ink">
            Your voucher at <span className="font-semibold">{continueVoucher.merchantName}</span> expires{" "}
            {daysUntilLabel(continueVoucher.expiresAt)}
          </span>
          <span className="shrink-0 font-semibold text-akiba-teal">Use it →</span>
        </TrackedLink>
      )}

      <IntentShortcuts intents={feed.intents} title="What are you looking for?" />

      <VoucherRail merchants={voucherMerchants} />

      {/* A genuinely personalized result belongs near the top; the
          cold-start "Worth a look" cascade is demoted below (workstream 5). */}
      {forYou?.personalized && (
        <MerchantRail section={forYou} seeAllHref="/merchants" description="Relevant places based on how you use Akiba." />
      )}

      <LocationOptIn cities={cities} />

      {newMerchants && <MerchantRail section={newMerchants} seeAllHref="/merchants" />}

      {forYou && !forYou.personalized && (
        <MerchantRail section={forYou} seeAllHref="/merchants" description="Browse places to shop, both nearby and online." />
      )}
    </main>
  );
}
