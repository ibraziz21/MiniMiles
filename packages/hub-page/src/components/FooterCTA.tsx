import { ButtonLink } from "@/components/ButtonLink";
import { AKIBA_HUB_APP_URL } from "@/constants/links";

export function FooterCTA() {
  return (
    <section className="bg-akiba-paper px-4 py-20 sm:px-6 lg:px-8">
      <div className="surface-grid relative mx-auto max-w-7xl overflow-hidden rounded-lg bg-akiba-tint px-6 py-16 text-center sm:px-10">
        <p className="font-sterling text-base font-medium text-akiba-teal">Get Started</p>
        <h2 className="mx-auto mt-3 max-w-2xl font-sterling text-4xl font-medium leading-[1.08] text-akiba-ink sm:text-5xl">
          Ready to discover your rewards?
        </h2>
        <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-akiba-muted">
          Open the app, connect your wallets, and unlock personalized rewards across campaigns,
          games, raffles, and partner quests.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <ButtonLink href={AKIBA_HUB_APP_URL} className="w-full sm:w-auto">
            Open Akiba Pass App
          </ButtonLink>
          <a
            href="#featured"
            className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-akiba-line bg-white px-5 py-3 font-sterling text-base font-medium text-akiba-ink no-underline transition hover:border-akiba-teal hover:text-akiba-teal sm:w-auto"
          >
            Explore Featured Campaigns
          </a>
        </div>
      </div>
    </section>
  );
}
