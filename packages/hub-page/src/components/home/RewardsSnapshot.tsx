"use client";

// Client component so the GetVoucherButton analytics callbacks below can be
// passed directly (a function prop can't cross the server/client boundary
// from a Server Component) — see NextRewardPanel.tsx for the same reasoning.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { MilesAmount, MilesIcon } from "@/components/MilesIcon";
import { RewardProgressBar } from "@/components/akiba/RewardProgressBar";
import { NextRewardViewTracker, progressBucket } from "@/components/akiba/NextRewardViewTracker";
import { GetVoucherButton } from "@/components/vouchers/GetVoucherButton";
import { NEXT_REWARD_SHOPPING_WAY, type NextRewardSummary } from "@/lib/akiba/nextReward";
import { track } from "@/lib/analytics/track";

/**
 * Compact rewards snapshot (home-redesign-spec.md §6.6) — renders after
 * discovery, not before it. When Next Reward Progress V1
 * (next-reward-progress-v1-spec.md) is enabled for this member and has a
 * recommendation, it evolves this same card in place — one card, not two,
 * so the Miles balance never appears twice — while the active-voucher and
 * Pass tiles below always stay visible. Outside that cohort (or when the
 * recommendation is unavailable), the card renders exactly as before.
 */
export function RewardsSnapshot({
  milesBalance,
  activeVoucherCount,
  hasPass,
  nextReward,
}: {
  milesBalance: number;
  activeVoucherCount: number;
  hasPass: boolean;
  nextReward: NextRewardSummary | null;
}) {
  const recommended = nextReward?.state === "recommended" ? nextReward : null;

  return (
    <section className="rounded-2xl border border-akiba-line bg-white p-4">
      {recommended ? (
        <NextRewardCompact summary={recommended} />
      ) : (
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">Your rewards</p>
      )}

      <div className="flex items-center gap-3">
        <TrackedLink
          href="/games"
          event="home_rewards_tap"
          eventProps={{ target: "miles" }}
          className="flex flex-1 items-center gap-2 rounded-xl bg-akiba-tint px-3.5 py-3 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
        >
          <MilesIcon className="h-5 w-5 shrink-0" />
          <span className="min-w-0">
            <span className="block font-sterling text-base font-semibold text-akiba-ink">
              {milesBalance.toLocaleString("en-KE")}
            </span>
            <span className="block text-xs text-akiba-muted">Miles</span>
          </span>
        </TrackedLink>

        {activeVoucherCount > 0 && (
          <TrackedLink
            href="/vouchers"
            event="home_rewards_tap"
            eventProps={{ target: "vouchers" }}
            className="flex flex-1 flex-col items-start rounded-xl bg-akiba-card px-3.5 py-3 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            <span className="font-sterling text-base font-semibold text-akiba-ink">{activeVoucherCount}</span>
            <span className="text-xs text-akiba-muted">active voucher{activeVoucherCount === 1 ? "" : "s"}</span>
          </TrackedLink>
        )}

        {hasPass && (
          <TrackedLink
            href="/pass"
            event="home_rewards_tap"
            eventProps={{ target: "pass" }}
            className="flex flex-1 flex-col items-start rounded-xl bg-akiba-ink px-3.5 py-3 text-white transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            <span className="font-sterling text-base font-semibold">Pass</span>
            <span className="text-xs text-white/60">View Pass</span>
          </TrackedLink>
        )}
      </div>
    </section>
  );
}

/** [symbol]balance / [symbol]target — one icon covers the whole pairing
 *  rather than repeating it, since both numbers are the same denomination. */
function MilesRange({ balance, target }: { balance: number; target: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-sterling font-semibold text-akiba-ink">
      <MilesIcon className="h-4 w-4 shrink-0" />
      {balance.toLocaleString("en-KE")} / {target.toLocaleString("en-KE")}
    </span>
  );
}

function NextRewardCompact({ summary }: { summary: Extract<NextRewardSummary, { state: "recommended" }> }) {
  const { target, progress, balance, recommendationLabel } = summary;
  const [expanded, setExpanded] = useState(false);

  if (progress.affordable) {
    return (
      <div className="mb-3">
        <NextRewardViewTracker
          surface="home"
          state="affordable"
          templateId={target.templateId}
          merchantId={target.merchantId}
          recommendationLabel={recommendationLabel}
          progressBucket={progressBucket(progress.percent, true)}
        />
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-akiba-muted">Reward available</p>
        <p className="mb-3 text-sm text-akiba-ink">
          You have enough for <span className="font-semibold">{target.benefitLabel} at {target.merchantName}</span>.
        </p>
        <GetVoucherButton
          templateId={target.templateId}
          milesCost={target.milesCost}
          isSignedIn
          sourceSurface="home"
          onInteract={() => {
            track("next_reward_primary_tap", { surface: "home", template_id: target.templateId, action: "get_voucher" });
            track("next_reward_acquisition_started", { surface: "home", template_id: target.templateId });
          }}
          onQueued={() => track("next_reward_voucher_queued", { surface: "home", template_id: target.templateId })}
        />
      </div>
    );
  }

  return (
    <div className="mb-3">
      <NextRewardViewTracker
        surface="home"
        state="locked"
        templateId={target.templateId}
        merchantId={target.merchantId}
        recommendationLabel={recommendationLabel}
        progressBucket={progressBucket(progress.percent, false)}
      />
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-akiba-muted">Next reward</p>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="home-next-reward-detail"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-akiba-muted transition hover:bg-akiba-card active:scale-[0.9]"
        >
          <ChevronDown className={clsx("h-4 w-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")} />
          <span className="sr-only">{expanded ? "Show less" : "Show more"}</span>
        </button>
      </div>

      <p className="truncate text-sm font-semibold text-akiba-ink">
        {target.benefitLabel} at {target.merchantName}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs">
        <MilesRange balance={balance} target={target.milesCost} />
        <span className="text-akiba-muted">{progress.percent}%</span>
      </div>
      <div className="mt-1.5">
        <RewardProgressBar balance={balance} milesCost={target.milesCost} size="sm" />
      </div>

      {/* Collapsed by default — just eyebrow, voucher and progress above.
          Everything else (gap-to-go, why it was picked, ways to earn, CTAs)
          lives here and only shows once the member taps the chevron. */}
      <div
        id="home-next-reward-detail"
        className={clsx(
          "grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr] mt-2" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <p className="flex items-center gap-1 text-xs text-akiba-muted">
            <MilesAmount amount={progress.gapMiles} size="xs" className="text-akiba-muted" /> to go
          </p>
          <p className="mt-1.5 text-xs text-akiba-muted">{target.explanation}</p>
          <p className="mt-1.5 text-xs text-akiba-muted">
            {NEXT_REWARD_SHOPPING_WAY.label} — Miles vary by active offer
          </p>

          <div className="mt-3 flex gap-2">
            <TrackedLink
              href="/me#next-reward"
              event="next_reward_primary_tap"
              eventProps={{ surface: "home", template_id: target.templateId, action: "see_how" }}
              className="flex-1 rounded-full bg-akiba-ink px-3.5 py-2 text-center text-xs font-semibold text-white transition active:scale-[0.98]"
            >
              See how to get there
            </TrackedLink>
            <TrackedLink
              href="/vouchers"
              event="next_reward_all_vouchers_tap"
              eventProps={{ surface: "home", template_id: target.templateId }}
              className="flex-1 rounded-full border border-akiba-line px-3.5 py-2 text-center text-xs font-semibold text-akiba-ink transition active:scale-[0.98]"
            >
              View all vouchers
            </TrackedLink>
          </div>
        </div>
      </div>
    </div>
  );
}
