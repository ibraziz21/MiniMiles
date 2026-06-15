import { AKIBA_HUB_APP_URL } from "@/constants/links";

export function AppBanner() {
  return (
    <div className="border-b border-akiba-line bg-akiba-paper px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4">
        <div>
          <h1 className="font-sterling text-2xl font-semibold text-akiba-ink sm:text-3xl">
            Discover rewards
          </h1>
          <p className="mt-0.5 text-sm text-akiba-muted">
            Live campaigns, quests, games, raffles, and vouchers across AkibaMiles.
            Open the app to check eligibility.
          </p>
        </div>
        <a
          href={AKIBA_HUB_APP_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="hidden shrink-0 items-center gap-2 rounded-full border border-akiba-line bg-white px-4 py-2.5 text-sm font-semibold text-akiba-ink no-underline transition hover:border-akiba-teal hover:text-akiba-teal sm:inline-flex"
        >
          Connect wallet in app →
        </a>
      </div>
    </div>
  );
}
