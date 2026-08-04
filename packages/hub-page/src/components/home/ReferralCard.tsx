import { TrackedLink } from "@/components/akiba/TrackedLink";
import { MilesAmount } from "@/components/MilesIcon";
import { ReferralCardViewTracker } from "./ReferralCardViewTracker";
import type { ReferralDashboard } from "@/lib/akiba/referralDashboard";

/**
 * Home referral card (referral-system-spec.md §9.1). Placed in the rewards/
 * tool section after discovery, not above it. Generic invite copy until the
 * member has referral activity, then a compact progress line — matches
 * RewardsSnapshot's two-tier "snapshot, not a dashboard" role on this page.
 */
export function ReferralCard({ dashboard }: { dashboard: ReferralDashboard }) {
  const { summary, program } = dashboard;
  const hasActivity = summary.friendsJoined > 0;
  const totalMiles = program.signupMiles + program.activationMiles;

  return (
    <section className="mb-4 rounded-2xl border border-akiba-line bg-white p-4">
      <ReferralCardViewTracker hasActivity={hasActivity} />

      {hasActivity ? (
        <>
          <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-akiba-muted">
            Your referrals
          </p>
          <p className="mb-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-akiba-ink">
            <span>
              {summary.friendsJoined} friend{summary.friendsJoined === 1 ? "" : "s"} joined
            </span>
            <span aria-hidden="true">·</span>
            <span>{summary.friendsActivated} activated</span>
            <span aria-hidden="true">·</span>
            <span className="inline-flex items-center gap-1">
              <MilesAmount amount={summary.milesEarned} size="sm" /> earned
            </span>
          </p>
          <TrackedLink
            href="/referrals"
            event="referral_card_tap"
            eventProps={{ has_activity: true }}
            className="inline-flex items-center rounded-full bg-akiba-teal px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-ink"
          >
            View referrals
          </TrackedLink>
        </>
      ) : (
        <>
          <p className="font-sterling text-base font-semibold text-akiba-ink">
            Invite friends. Earn <MilesAmount amount={totalMiles} size="sm" className="inline-flex" />.
          </p>
          <p className="mt-1 text-sm text-akiba-muted">
            Get <MilesAmount amount={program.signupMiles} size="sm" className="inline-flex" /> when a friend joins Akiba
            Pass and <MilesAmount amount={program.activationMiles} size="sm" className="inline-flex" /> more after their
            first qualifying purchase or eligible voucher use.
          </p>
          <TrackedLink
            href="/referrals"
            event="referral_card_tap"
            eventProps={{ has_activity: false }}
            className="mt-3 inline-flex items-center rounded-full bg-akiba-teal px-4 py-2 text-sm font-semibold text-white transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-ink"
          >
            Invite friends
          </TrackedLink>
        </>
      )}
    </section>
  );
}
