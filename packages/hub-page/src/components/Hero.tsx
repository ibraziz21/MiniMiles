import { ButtonLink } from "@/components/ButtonLink";
import { AkibaMark } from "@/components/Logo";
import { AKIBA_HUB_APP_URL, PARTNER_WITH_AKIBA_URL } from "@/constants/links";

const stats = [
  { value: "6+", label: "Reward categories" },
  { value: "Daily", label: "New campaigns" },
  { value: "Multi-chain", label: "MiniPay & Base" },
];

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-akiba-paper px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
      <div className="surface-grid pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative mx-auto w-full max-w-7xl">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-akiba-tint px-4 py-2 text-sm font-semibold text-akiba-teal">
            <AkibaMark className="h-4 w-4" />
            <span>Akiba Hub — Public Discovery</span>
          </div>

          <h1 className="font-sterling text-5xl font-medium leading-[1.02] text-akiba-ink sm:text-6xl lg:text-7xl">
            Discover rewards, vouchers, games, and opportunities across AkibaMiles.
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-akiba-muted sm:text-xl">
            Akiba Hub helps you explore live campaigns, partner quests, games, raffles, promos, and
            merchant vouchers. Open the app to connect your wallets, choose your interests, and see
            personalized rewards you qualify for.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <ButtonLink href={AKIBA_HUB_APP_URL} className="w-full sm:w-auto animate-pulse-glow">
              Open Akiba Hub App
            </ButtonLink>
            <ButtonLink
              href={PARTNER_WITH_AKIBA_URL}
              variant="secondary"
              className="w-full sm:w-auto"
            >
              Launch a Campaign
            </ButtonLink>
          </div>

          <p className="mt-4 text-sm text-akiba-muted">
            Public discovery is free. Personalized rewards require OTP login inside the app.
          </p>
        </div>

        <div className="mt-14 grid grid-cols-3 gap-4 sm:gap-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="rounded-lg border border-akiba-line bg-white px-4 py-5 text-center shadow-chip"
            >
              <p className="font-sterling text-2xl font-semibold text-akiba-teal sm:text-3xl">
                {stat.value}
              </p>
              <p className="mt-1 text-xs text-akiba-muted sm:text-sm">{stat.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
