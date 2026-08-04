import { HomeViewTracker } from "@/components/akiba/HomeViewTracker";
import { HomeIntentSearch } from "@/components/home/HomeIntentSearch";
import { IntentShortcuts } from "@/components/home/IntentShortcuts";
import { MerchantRail } from "@/components/home/MerchantRail";
import { LocationOptIn } from "@/components/home/LocationOptIn";
import { RewardsSnapshot } from "@/components/home/RewardsSnapshot";
import { ReferralCard } from "@/components/home/ReferralCard";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getHomeFeed } from "@/lib/home/feed";
import { getReferralDashboard, type ReferralDashboard } from "@/lib/akiba/referralDashboard";
import { listDirectoryCities } from "@/lib/merchants/queries";
import type { User } from "@supabase/supabase-js";

// The intent-first member home — home-redesign-spec.md §2/§6. Expressing a
// need (search, then Browse-by-need) is the first action; Miles/vouchers/
// Pass move into a compact snapshot after discovery instead of leading it.
export async function MemberHome({ user }: { user: User }) {
  const email = user.email ?? null;

  const [{ displayName }, feed, cities, referralDashboard] = await Promise.all([
    resolveHubProfile({ userId: user.id, email }),
    getHomeFeed({ userId: user.id, userEmail: email }),
    listDirectoryCities().catch(() => [] as string[]),
    getReferralDashboard(user.id).catch((err) => {
      console.error("[home] referral dashboard failed:", err);
      return null as ReferralDashboard | null;
    }),
  ]);

  const firstName = displayName.split(" ")[0] || displayName;
  const forYou = feed.sections.find((s) => s.id === "for_you") ?? null;
  const limitedTime = feed.sections.find((s) => s.id === "limited_time") ?? null;

  return (
    <main className="mx-auto max-w-2xl px-4 pt-4 pb-2 sm:pt-8 sm:pb-4">
      <HomeViewTracker variant="member" />

      <div className="mb-4">
        <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">
          Welcome back, {firstName} 👋
        </h1>
        <p className="mt-1 text-akiba-muted">What are you looking for today?</p>
      </div>

      <div className="mb-4">
        <HomeIntentSearch placeholder="Search merchants or what you need…" />
      </div>

      <IntentShortcuts intents={feed.intents} title="Browse by need" />

      {forYou && <MerchantRail section={forYou} seeAllHref="/merchants" />}

      <LocationOptIn cities={cities} />

      {limitedTime && <MerchantRail section={limitedTime} seeAllHref="/vouchers" />}

      {feed.rewards && (
        <RewardsSnapshot
          milesBalance={feed.rewards.milesBalance}
          activeVoucherCount={feed.rewards.activeVoucherCount}
          hasPass={feed.rewards.hasPass}
        />
      )}

      {/* Only surface the card when there's something to show: either the
          program is actively taking new invites, or this member already
          has referral history (kept visible even if the program later
          pauses — an existing referral stays valid regardless). */}
      {referralDashboard &&
        (referralDashboard.program.status === "active" || referralDashboard.summary.friendsJoined > 0) && (
          <ReferralCard dashboard={referralDashboard} />
        )}
    </main>
  );
}
