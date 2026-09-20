"use client";

// Client component so the GetVoucherButton analytics callbacks below can be
// passed directly (a function prop can't cross the server/client boundary
// from a Server Component) — see RewardsSnapshot.tsx for the same reasoning.
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { MilesAmount, MilesRange } from "@/components/MilesIcon";
import { RewardProgressBar } from "@/components/akiba/RewardProgressBar";
import { NextRewardViewTracker, progressBucket } from "@/components/akiba/NextRewardViewTracker";
import { GetVoucherButton } from "@/components/vouchers/GetVoucherButton";
import { NEXT_REWARD_SHOPPING_WAY, type NextRewardSummary } from "@/lib/akiba/nextReward";
import { track } from "@/lib/analytics/track";

/**
 * Standalone Next Reward Progress card (next-reward-progress-v1-spec.md),
 * relocated near the top of Explore (discovery-blueprint.md §3, workstream
 * 3) instead of nested inside the bottom RewardsSnapshot card. This single
 * card already covers both "you can unlock this now" (progress.affordable)
 * and "almost there" (progress gap) — no separate rails needed, since the
 * selection logic in lib/akiba/nextReward.ts already picks the one
 * strongest candidate, weighing affinity/country/expiry.
 *
 * Only rendered by callers when `summary.state === "recommended"` — every
 * other state (balance/inventory unavailable, no eligible reward) means
 * nothing truthful to show, so the caller renders nothing at all.
 */
export function NextRewardCard({ summary }: { summary: Extract<NextRewardSummary, { state: "recommended" }> }) {
  const { target, progress, balance, recommendationLabel } = summary;
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="mb-4 rounded-2xl border border-akiba-line bg-white p-4">
      {progress.affordable ? (
        <div>
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
      ) : (
        <div>
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
            <span className="tabular-nums text-akiba-muted">{progress.percent}%</span>
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
      )}
    </section>
  );
}
