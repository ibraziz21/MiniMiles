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
    <section className="mb-5 overflow-hidden rounded-3xl border border-akiba-teal/15 bg-akiba-tint px-4 py-4 sm:mb-8 sm:px-7 sm:py-7">
      <div className="max-w-2xl">
        {firstName !== undefined && (
          <div className="mb-1.5 flex min-h-11 items-center justify-between gap-3 sm:mb-2">
            <p className="text-xs font-semibold text-akiba-teal">
              {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
            </p>
            {milesBalance != null && (
          <TrackedLink
            href="/games"
            event="home_rewards_tap"
            eventProps={{ target: "miles", surface: "header" }}
            aria-label={`${milesBalance.toLocaleString("en-KE")} AkibaMiles`}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-akiba-teal/15 bg-white px-3 py-2 shadow-chip transition hover:border-akiba-teal/30 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            <MilesIcon className="h-4 w-4 shrink-0" />
            <span className="font-sterling text-sm font-semibold tabular-nums text-akiba-ink">
              {milesBalance.toLocaleString("en-KE")}
            </span>
          </TrackedLink>
            )}
          </div>
        )}
        <h1 className="font-sterling text-[clamp(1.55rem,7vw,1.75rem)] font-semibold leading-[1.08] tracking-[-0.025em] text-akiba-ink sm:text-4xl">
          Find more value in the places you shop.
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-akiba-muted sm:text-base">
          Discover Akiba merchants and use your Miles on vouchers for everyday spending.
        </p>
      </div>

      <div className="mt-4 sm:mt-6">
        <HomeIntentSearch placeholder="Search Akiba…" />
      </div>
    </section>
  );
}
