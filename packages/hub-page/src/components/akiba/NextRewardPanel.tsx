"use client";

// Client component (not just for RewardProgressBar/TrackedLink, which are
// already client-only) so the analytics callbacks below can be passed
// directly to GetVoucherButton — a function prop can't cross the server/
// client boundary from a Server Component.
import { ArrowRight } from "lucide-react";
import type { NextRewardSummary, NextRewardWay } from "@/lib/akiba/nextReward";
import { RewardProgressBar } from "@/components/akiba/RewardProgressBar";
import { NextRewardViewTracker, progressBucket } from "@/components/akiba/NextRewardViewTracker";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { MilesAmount, MilesIcon } from "@/components/MilesIcon";
import { GetVoucherButton } from "@/components/vouchers/GetVoucherButton";
import { track } from "@/lib/analytics/track";

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

function WayAmount({ way }: { way: NextRewardWay }) {
  if (way.kind === "quest") {
    return <MilesAmount amount={way.miles} size="sm" prefix="+" className="text-akiba-teal" />;
  }
  if (way.kind === "game") {
    return (
      <span className="inline-flex items-center gap-1 text-akiba-teal">
        <span className="text-xs font-semibold">Up to</span>
        <MilesAmount amount={way.potentialMiles} size="sm" prefix="+" className="text-akiba-teal" />
      </span>
    );
  }
  return <span className="text-xs font-semibold text-akiba-teal">Miles vary by active offer</span>;
}

function WayRow({ way }: { way: NextRewardWay }) {
  return (
    <TrackedLink
      href={way.href}
      event="next_reward_earn_path_tap"
      eventProps={{ surface: "me", path_kind: way.kind, quest_key: way.kind === "quest" ? way.key : undefined }}
      className="flex items-center justify-between gap-3 rounded-xl bg-akiba-card px-3.5 py-3 transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
    >
      <span className="text-sm font-medium text-akiba-ink">{way.label}</span>
      <span className="shrink-0"><WayAmount way={way} /></span>
    </TrackedLink>
  );
}

function ViewAllVouchersLink({ templateId }: { templateId?: string }) {
  return (
    <TrackedLink
      href="/vouchers"
      event="next_reward_all_vouchers_tap"
      eventProps={{ surface: "me", template_id: templateId ?? null }}
      className="flex items-center justify-center gap-1 rounded-full border border-akiba-line px-4 py-2.5 text-sm font-semibold text-akiba-ink transition active:scale-[0.98]"
    >
      View all vouchers
    </TrackedLink>
  );
}

/**
 * Next Reward Progress V1 (next-reward-progress-v1-spec.md) — the full
 * `/me` panel (§5.2/§9). Renders every state directly off
 * `NextRewardSummary`'s discriminated union so an inventory/RPC failure can
 * never be mistaken for "no eligible reward."
 */
export function NextRewardPanel({
  summary,
  ways,
}: {
  summary: NextRewardSummary;
  ways: NextRewardWay[];
}) {
  if (summary.state === "balance_unavailable") {
    return (
      <section id="next-reward" className="rounded-2xl border border-akiba-line bg-white p-5">
        <NextRewardViewTracker surface="me" state="unavailable" reason="balance_unavailable" />
        <p className="text-sm text-akiba-muted">Reward progress is temporarily unavailable.</p>
        <a href="/vouchers" className="mt-3 inline-flex text-sm font-semibold text-akiba-teal">
          View vouchers
        </a>
      </section>
    );
  }

  // Recommendation service failed but balance is fine — omit target/progress
  // entirely rather than render a broken-looking card (§9.5). The balance
  // card and quick actions elsewhere on /me already stand on their own.
  if (summary.state === "inventory_unavailable") return null;

  if (summary.state === "no_eligible_reward") {
    return (
      <section id="next-reward" className="rounded-2xl border border-akiba-line bg-white p-5">
        <NextRewardViewTracker surface="me" state="no_eligible_reward" />
        <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">Your rewards</p>
        <p className="flex items-center gap-1 text-sm text-akiba-ink">
          You have <MilesAmount amount={summary.balance} size="sm" />.
        </p>
        <p className="mt-1 text-sm text-akiba-muted">New merchant rewards will appear here when available.</p>
        <a
          href="/merchants"
          className="mt-4 inline-flex items-center gap-1 rounded-full bg-akiba-ink px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
        >
          Explore merchants <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </section>
    );
  }

  const { target, progress, recommendationLabel, balance } = summary;

  if (progress.affordable) {
    return (
      <section id="next-reward" className="rounded-2xl border border-akiba-line bg-white p-5">
        <NextRewardViewTracker
          surface="me"
          state="affordable"
          templateId={target.templateId}
          merchantId={target.merchantId}
          recommendationLabel={recommendationLabel}
          progressBucket={progressBucket(progress.percent, true)}
        />
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-akiba-muted">Reward available</p>
        <div className="mb-4 flex items-center gap-3">
          {target.merchantLogoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={target.merchantLogoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
          ) : null}
          <p className="text-base text-akiba-ink">
            You have enough for <span className="font-semibold">{target.benefitLabel} at {target.merchantName}</span>.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <GetVoucherButton
              templateId={target.templateId}
              milesCost={target.milesCost}
              isSignedIn
              sourceSurface="me"
              onInteract={() => {
                track("next_reward_primary_tap", { surface: "me", template_id: target.templateId, action: "get_voucher" });
                track("next_reward_acquisition_started", { surface: "me", template_id: target.templateId });
              }}
              onQueued={() => track("next_reward_voucher_queued", { surface: "me", template_id: target.templateId })}
            />
          </div>
          <ViewAllVouchersLink templateId={target.templateId} />
        </div>
      </section>
    );
  }

  return (
    <section id="next-reward" className="rounded-2xl border border-akiba-line bg-white p-5">
      <NextRewardViewTracker
        surface="me"
        state="locked"
        templateId={target.templateId}
        merchantId={target.merchantId}
        recommendationLabel={recommendationLabel}
        progressBucket={progressBucket(progress.percent, false)}
      />
      <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-akiba-muted">Next reward</p>
      <div className="mb-3 flex items-center gap-3">
        {target.merchantLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={target.merchantLogoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-akiba-ink">{target.benefitLabel} at {target.merchantName}</p>
          <p className="text-xs text-akiba-muted">{target.explanation}</p>
        </div>
      </div>

      <div className="mb-1.5 flex items-baseline justify-between text-sm">
        <MilesRange balance={balance} target={target.milesCost} />
        <span className="text-akiba-muted">{progress.percent}%</span>
      </div>
      <RewardProgressBar balance={balance} milesCost={target.milesCost} />
      <p className="mt-2 flex items-center gap-1 text-sm text-akiba-muted">
        <MilesAmount amount={progress.gapMiles} size="sm" className="text-akiba-muted" /> to go
      </p>

      {ways.length > 0 && (
        <div className="mt-4 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-akiba-muted">Ways to get closer</p>
          {ways.map((way) => (
            <WayRow key={way.kind === "quest" ? `quest-${way.key}` : way.kind} way={way} />
          ))}
        </div>
      )}

      <div className="mt-4">
        <ViewAllVouchersLink templateId={target.templateId} />
      </div>
    </section>
  );
}
