import { computeProgress } from "@/lib/akiba/nextReward";

/**
 * Accessible progress bar for Next Reward Progress V1
 * (next-reward-progress-v1-spec.md §7). The visible percentage/bar is
 * supplementary — `aria-valuetext` carries the exact accessible sentence the
 * spec requires so a screen reader never has to infer meaning from a percent
 * alone.
 */
export function RewardProgressBar({
  balance,
  milesCost,
  size = "md",
}: {
  balance: number;
  milesCost: number;
  size?: "sm" | "md";
}) {
  const { gapMiles, percent, affordable } = computeProgress(balance, milesCost);
  const clampedBalance = Math.min(balance, milesCost);
  const valueText = affordable
    ? `${milesCost.toLocaleString("en-KE")} of ${milesCost.toLocaleString("en-KE")} Miles. Reward available.`
    : `${clampedBalance.toLocaleString("en-KE")} of ${milesCost.toLocaleString("en-KE")} Miles. ${gapMiles.toLocaleString("en-KE")} Miles remaining. ${percent} percent complete.`;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={milesCost}
      aria-valuenow={clampedBalance}
      aria-valuetext={valueText}
      className={size === "sm" ? "h-1.5 w-full overflow-hidden rounded-full bg-akiba-line" : "h-2.5 w-full overflow-hidden rounded-full bg-akiba-line"}
    >
      <div
        className="h-full rounded-full bg-akiba-teal motion-safe:transition-[width] motion-safe:duration-500"
        style={{ width: `${affordable ? 100 : percent}%` }}
      />
    </div>
  );
}
