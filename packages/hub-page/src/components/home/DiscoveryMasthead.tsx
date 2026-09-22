import { MilesIcon } from "@/components/MilesIcon";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { HomeIntentSearch } from "./HomeIntentSearch";

export function DiscoveryMasthead({
  firstName,
  milesBalance,
}: {
  firstName?: string | null;
  milesBalance?: number | null;
}) {
  return (
    <section className="mb-6 overflow-hidden rounded-3xl border border-akiba-teal/15 bg-akiba-tint px-4 py-5 sm:mb-8 sm:px-7 sm:py-7">
      <div className="flex items-start justify-between gap-4">
        <div className="max-w-2xl">
          {firstName !== undefined && (
            <p className="mb-1 text-xs font-semibold text-akiba-teal">
              {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
            </p>
          )}
          <h1 className="font-sterling text-[1.75rem] font-semibold leading-[1.1] tracking-[-0.02em] text-akiba-ink sm:text-4xl">
            Find more value in the places you shop.
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-akiba-muted sm:text-base">
            Discover Akiba merchants and use your Miles on vouchers for everyday spending.
          </p>
        </div>

        {milesBalance != null && (
          <TrackedLink
            href="/games"
            event="home_rewards_tap"
            eventProps={{ target: "miles", surface: "header" }}
            aria-label={`${milesBalance.toLocaleString("en-KE")} AkibaMiles`}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-akiba-teal/15 bg-white px-3 py-2 shadow-chip transition hover:border-akiba-teal/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            <MilesIcon className="h-4 w-4 shrink-0" />
            <span className="font-sterling text-sm font-semibold tabular-nums text-akiba-ink">
              {milesBalance.toLocaleString("en-KE")}
            </span>
          </TrackedLink>
        )}
      </div>

      <div className="mt-5 sm:mt-6">
        <HomeIntentSearch placeholder="Search food, fuel, internet, or a merchant…" />
      </div>
    </section>
  );
}
