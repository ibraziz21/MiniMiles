import { MilesIcon } from "@/components/MilesIcon";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { HomeViewTracker } from "@/components/akiba/HomeViewTracker";
import { HomeIntentSearch } from "@/components/home/HomeIntentSearch";
import { IntentShortcuts } from "@/components/home/IntentShortcuts";
import { MerchantRail } from "@/components/home/MerchantRail";
import { LocationOptIn } from "@/components/home/LocationOptIn";
import { NextRewardCard } from "@/components/home/NextRewardCard";
import { RewardsSnapshot } from "@/components/home/RewardsSnapshot";
import { RewardsSnapshotError } from "@/components/home/RewardsSnapshotError";
import { ReferralCard } from "@/components/home/ReferralCard";
import { resolveHubProfile } from "@/lib/akiba/hubProfile";
import { getHomeFeed } from "@/lib/home/feed";
import { getReferralDashboard, type ReferralDashboard } from "@/lib/akiba/referralDashboard";
import { listDirectoryCities } from "@/lib/merchants/queries";
import type { User } from "@supabase/supabase-js";

function daysUntilLabel(expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const days = Math.max(1, Math.ceil(ms / 86_400_000));
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

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

  // displayName falls back to the raw email (resolveHubProfile) when the
  // member has set neither a full name nor a username — never surface that
  // as a "name" in the greeting.
  const firstName = displayName.includes("@") ? null : displayName.split(" ")[0] || displayName;
  const forYou = feed.sections.find((s) => s.id === "for_you") ?? null;
  const limitedTime = feed.sections.find((s) => s.id === "limited_time") ?? null;
  const newMerchants = feed.sections.find((s) => s.id === "new") ?? null;

  const recommendedReward = feed.nextReward?.state === "recommended" ? feed.nextReward : null;
  const continueVoucher = feed.rewards?.continueVoucher ?? null;

  return (
    <main className="mx-auto max-w-2xl px-4 pt-4 pb-2 sm:pt-8 sm:pb-4">
      <HomeViewTracker variant="member" />

      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-sterling text-2xl font-semibold text-akiba-ink">
            {firstName ? `Welcome back, ${firstName}` : "Welcome back"} 👋
          </h1>
          <p className="mt-1 text-akiba-muted">What are you looking for today?</p>
        </div>
        {/* Compact balance, above the fold (discovery-blueprint.md §3,
            workstream 4) — every module below (Next Reward, "Deals for
            you") leans on the user already knowing this number. Only
            renders when the snapshot read actually succeeded; a failed
            read must never be shown as a real balance, even a small one. */}
        {feed.rewards && (
          <TrackedLink
            href="/games"
            event="home_rewards_tap"
            eventProps={{ target: "miles", surface: "header" }}
            className="flex shrink-0 items-center gap-1.5 rounded-full bg-akiba-tint px-3 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            <MilesIcon className="h-4 w-4 shrink-0" />
            <span className="font-sterling text-sm font-semibold tabular-nums text-akiba-ink">
              {feed.rewards.milesBalance.toLocaleString("en-KE")}
            </span>
          </TrackedLink>
        )}
      </div>

      <div className="mb-4">
        <HomeIntentSearch placeholder="Search merchants or what you need…" />
      </div>

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

      <IntentShortcuts intents={feed.intents} title="Browse by need" />

      {/* Next Reward Progress — relocated near the top of Explore instead of
          nested in the bottom rewards snapshot (discovery-blueprint.md §3,
          workstream 3). Already covers both "you can unlock this now" and
          "almost there" via progress.affordable — no separate rails. */}
      {recommendedReward && <NextRewardCard summary={recommendedReward} />}

      {/* A genuinely personalized result belongs near the top; the
          cold-start "Worth a look" cascade is demoted below (workstream 5). */}
      {forYou?.personalized && <MerchantRail section={forYou} seeAllHref="/merchants" />}

      <LocationOptIn cities={cities} />

      {limitedTime && <MerchantRail section={limitedTime} seeAllHref="/vouchers" />}

      {newMerchants && <MerchantRail section={newMerchants} seeAllHref="/merchants" />}

      {forYou && !forYou.personalized && <MerchantRail section={forYou} seeAllHref="/merchants" />}

      {feed.rewards ? (
        <RewardsSnapshot
          milesBalance={feed.rewards.milesBalance}
          activeVoucherCount={feed.rewards.activeVoucherCount}
          hasPass={feed.rewards.hasPass}
        />
      ) : (
        // feed.rewards is only null here for a signed-in member (this
        // component only renders when authed) when getRewardsSnapshot threw
        // — see lib/home/feed.ts. Never hide that: this is the one number a
        // returning member opens the app to check.
        <RewardsSnapshotError />
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
