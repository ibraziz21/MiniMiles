"use client";

// Mastery economy v1 game-UX copy
// (skill-games-mastery-economy-and-direct-commerce-cleanup-v1-spec.md §5).
// Composed entirely on the Pass side and passed into @akiba/skill-games's
// shared GameIntroSheet/GameResultSheet via their entryBannerOverride /
// rewardSummaryOverride slots — the shared components stay economy-neutral,
// this is where "mastery" as a concept actually lives. Every branch here is
// driven by status.economyVersion / result.economyVersion, so copy always
// matches whatever the Backend's SKILL_GAME_ECONOMY_VERSION kill switch is
// actually doing — never hardcode mastery language outside that gate.
import type { GameType, RewardThreshold } from "@akiba/skill-games/core";
import { SCORE_BANDS, MASTERY_ECONOMY_V1 } from "@akiba/skill-games/core";
// hub-page's own MilesAmount (self-contained icon+amount), not the shared
// package's — importing anything from @akiba/skill-games/components here
// would pull the whole components barrel (game boards, leaderboard cards,
// ...) into every module that imports this file, including non-React
// contexts like unit tests.
import { MilesAmount } from "@/components/MilesIcon";
import type { PlayStatus, FinishResult } from "./clientTransport";

const TIER_LABEL = { moderate: "Moderate", strong: "Strong", elite: "Elite" } as const;

export function isMasteryActive(status: PlayStatus | null): boolean {
  return status?.economyVersion === "mastery-v1";
}

/** Moderate 1 / Strong 2 / Elite 3 — same RewardThreshold shape the intro
 *  sheet's existing "Reward tiers" list already renders generically. */
export function masteryThresholds(gameType: GameType): RewardThreshold[] {
  return SCORE_BANDS[gameType].map((band) => ({
    label: TIER_LABEL[band.tier],
    minScore: band.minScore,
    miles: MASTERY_ECONOMY_V1.milesByTier[band.tier],
    stable: 0,
  }));
}

// §5.1 — "Do not say 'win up to 3 Miles per round.' Say 'earn up to 3 Miles
// from your best [game] tier today.'"
export function MasteryEntryBanner({
  shortName,
  status,
}: {
  shortName: string;
  status: PlayStatus;
}) {
  const eliteMiles = MASTERY_ECONOMY_V1.milesByTier.elite;
  const availableToday = status.gameMilesAvailableToday ?? eliteMiles;
  const monthRemaining = status.monthlyGameMilesRemaining;

  return (
    <div className="rounded-xl bg-[#F0FDFF] border border-[#238D9D22] px-4 py-3">
      <p className="text-sm font-semibold text-[#238D9D]">Free play</p>
      <p className="text-xs text-[#525252] font-poppins mt-0.5 flex items-center gap-1 flex-wrap">
        Earn up to <MilesAmount amount={eliteMiles} size="xs" /> from your best {shortName} tier today.
        Improve your score to earn the difference.
      </p>
      <p className="text-xs text-[#817E7E] font-poppins mt-1.5">
        {status.playsRemaining} of {status.dailyCap} starts left today
        {availableToday > 0 && availableToday < eliteMiles
          ? ` · ${availableToday} Mile${availableToday === 1 ? "" : "s"} still available today`
          : ""}
        {monthRemaining != null
          ? ` · ${monthRemaining}/${MASTERY_ECONOMY_V1.monthlyBaseMilesCap} Miles left this month`
          : ""}
      </p>
    </div>
  );
}

// §5.2 — result copy states, matched to the spec's own examples verbatim
// where a shape exists for them.
export function masteryResultCopy(result: FinishResult): { title: string; subtitle: string } {
  const tierLabel =
    result.tierAchieved && result.tierAchieved !== "none" ? TIER_LABEL[result.tierAchieved] : null;
  const milesCredited = result.milesCreditedThisRound ?? 0;
  const milesWord = `${milesCredited} Mile${milesCredited === 1 ? "" : "s"}`;
  const eliteMiles = MASTERY_ECONOMY_V1.milesByTier.elite;
  const attemptsLeft = result.playsRemaining ?? 0;

  switch (result.rewardReason) {
    case "new_tier": {
      const isFirstTierToday = result.previousBestTier === "none";
      const isElite = result.tierAchieved === "elite";
      const title = isElite
        ? `${tierLabel} mastered — +${milesWord}`
        : isFirstTierToday
          ? `New best · ${tierLabel} — +${milesWord}`
          : `Tier improved · ${tierLabel} — +${milesWord}`;
      const today = result.gameMilesToday ?? milesCredited;
      return { title, subtitle: `${today}/${eliteMiles} earned today` };
    }
    case "tier_maintained":
      return { title: `${tierLabel ?? "Best tier"} maintained · No extra Miles`, subtitle: "Score submitted to leaderboard" };
    case "monthly_cap":
      return { title: "Monthly game Miles complete", subtitle: "Your score still counts" };
    case "below_threshold":
      return {
        title: "Below Moderate · Try again",
        subtitle: `${attemptsLeft} attempt${attemptsLeft === 1 ? "" : "s"} left`,
      };
    case "rejected":
      return { title: "Result not accepted", subtitle: "This round didn't qualify for scoring or Miles." };
    default:
      return { title: "Round complete", subtitle: "" };
  }
}

export function MasteryResultSummary({ result }: { result: FinishResult }) {
  const { title, subtitle } = masteryResultCopy(result);
  const milesCredited = result.milesCreditedThisRound ?? 0;
  return (
    <>
      <div className="min-w-0">
        <p className="text-base font-bold text-[#1A1A1A]">{title}</p>
        {subtitle && <p className="mt-0.5 text-xs text-[#817E7E] font-poppins">{subtitle}</p>}
      </div>
      {milesCredited > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 text-sm font-bold text-amber-700">
          <MilesAmount amount={milesCredited} size="sm" />
        </div>
      )}
    </>
  );
}
