import { TrackedLink } from "@/components/akiba/TrackedLink";
import { MilesIcon } from "@/components/MilesIcon";

/**
 * Compact rewards snapshot (spec §6.6) — renders after discovery, not
 * before it. No QR here (that's `/pass`/the nav Pass pill's job).
 */
export function RewardsSnapshot({
  milesBalance,
  activeVoucherCount,
  hasPass,
}: {
  milesBalance: number;
  activeVoucherCount: number;
  hasPass: boolean;
}) {
  return (
    <section className="rounded-2xl border border-akiba-line bg-white p-4">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-akiba-muted">Your rewards</p>
      <div className="flex items-center gap-3">
        <TrackedLink
          href="/rewards"
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
