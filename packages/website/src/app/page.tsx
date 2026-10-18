import Link from "next/link";
import { ArrowUpRight, BellRing, Check, Compass, Heart, Ticket, Wallet } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { Eyebrow } from "@/components/Eyebrow";
import { FaqAccordion } from "@/components/FaqAccordion";
import { Panel } from "@/components/Panel";
import { PhoneFrame } from "@/components/PhoneFrame";
import { SectionHeader } from "@/components/SectionHeader";
import { WaitlistForm } from "@/components/WaitlistForm";
import { faqs, homeContent, pillars, siteConfig } from "@/content/site";

const pillarIcons = {
  discover: Compass,
  earn: Wallet,
  vouchers: Ticket,
  recommend: Heart,
  offers: BellRing,
} as const;

export default function HomePage() {
  const { hero, app } = homeContent;

  return (
    <main>
      {/* Hero */}
      <Panel tone="wash" bare>
        <div className="grid items-center gap-10 px-5 pb-0 pt-12 sm:px-10 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:gap-6 lg:px-14 lg:pt-20">
          <div className="flex flex-col items-start gap-6 pb-12 lg:pb-20">
            <Eyebrow>{hero.eyebrow}</Eyebrow>
            <div className="space-y-5">
              <h1 className="font-sterling text-[2.9rem] font-medium leading-[1.02] tracking-[-0.02em] text-akiba-ink sm:text-6xl lg:text-[4.1rem]">
                {hero.title}
              </h1>
              <p className="max-w-xl text-lg leading-8 text-akiba-muted">{hero.body}</p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
              <ButtonLink href={siteConfig.passUrl}>{hero.primaryCta}</ButtonLink>
              <ButtonLink href="/merchants" variant="secondary">
                {hero.secondaryCta}
              </ButtonLink>
            </div>
            <Link
              href="#app"
              className="inline-flex items-center gap-2 rounded-full border border-akiba-teal/25 bg-akiba-tint px-4 py-2 text-sm font-semibold text-akiba-teal no-underline transition hover:border-akiba-teal"
            >
              {hero.badge}
            </Link>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-akiba-muted">
              {hero.assurances.map((item) => (
                <li key={item} className="inline-flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-akiba-teal" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-center lg:justify-end">
            <PhoneFrame
              src="/app/explore.webp"
              alt={hero.imageAlt}
              priority
              className="max-w-[260px] translate-y-2 sm:max-w-[300px] lg:translate-y-8"
            />
          </div>
        </div>

        {/* Proof strip, inside the hero card */}
        <div className="border-t border-akiba-line/70 bg-white/45 px-5 py-6 sm:px-10 lg:px-14">
          <dl className="mx-auto grid max-w-3xl grid-cols-3 gap-4 text-center">
            {homeContent.proofStats.map((stat) => (
              <div key={stat.label}>
                <dt className="sr-only">{stat.label}</dt>
                <dd>
                  <span className="block font-sterling text-2xl font-semibold text-akiba-ink sm:text-3xl">
                    {stat.value}
                  </span>
                  <span className="mt-1 block text-xs font-medium text-akiba-muted sm:text-sm">
                    {stat.label}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </Panel>

      {/* Pillar index */}
      <Panel id="what-you-get" tone="white">
        <SectionHeader
          eyebrow={homeContent.whatYouGet.eyebrow}
          title={homeContent.whatYouGet.title}
          align="center"
        />
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {pillars.map((pillar) => {
            const Icon = pillarIcons[pillar.id as keyof typeof pillarIcons];
            return (
              <li key={pillar.id}>
                <Link
                  href={`#${pillar.id}`}
                  className="flex h-full flex-col gap-4 rounded-[1.25rem] border border-akiba-line bg-akiba-paper p-5 no-underline transition hover:-translate-y-0.5 hover:border-akiba-teal/40 hover:bg-akiba-tint hover:shadow-chip"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-akiba-teal text-white">
                    <Icon className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="font-sterling text-lg font-medium leading-tight text-akiba-ink">
                    {pillar.title}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* App: the prominent moment */}
      <Panel id="app" tone="teal" bare>
        <div className="grid gap-10 px-5 pt-12 sm:px-10 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-end lg:gap-8 lg:px-14 lg:pt-20">
          <div className="flex flex-col items-start gap-6 pb-12 lg:pb-20">
            <Eyebrow tone="onDark">{app.eyebrow}</Eyebrow>
            <h2 className="font-sterling text-[2.6rem] font-medium leading-[1.03] tracking-[-0.02em] sm:text-5xl lg:text-[3.5rem]">
              {app.title}
            </h2>
            <p className="max-w-xl text-lg leading-8 text-white/75">{app.body}</p>

            <div className="flex flex-wrap gap-3">
              {app.platforms.map((platform) => (
                <div
                  key={platform.name}
                  className="rounded-2xl border border-white/20 bg-white/10 px-5 py-3 backdrop-blur"
                >
                  <p className="font-sterling text-lg font-semibold leading-none">{platform.name}</p>
                  <p className="mt-1.5 text-xs text-white/65">{platform.status}</p>
                </div>
              ))}
            </div>

            <div className="w-full max-w-md rounded-[1.25rem] border border-white/15 bg-white/10 p-4 backdrop-blur">
              <WaitlistForm
                source="website_app_waitlist"
                tone="dark"
                submitLabel="Notify me"
                successMessage="You're on the list. We'll email you the day the app lands."
                footnote="One email when the app ships. Nothing else."
              />
            </div>

            <p className="text-sm text-white/60">
              {app.meanwhile} ·{" "}
              <a
                href={siteConfig.passUrl}
                className="font-semibold text-white underline underline-offset-4"
              >
                {app.meanwhileCta}
              </a>
            </p>
          </div>

          <div className="relative flex items-end justify-center gap-4 lg:justify-end">
            <PhoneFrame
              src="/app/rewards.webp"
              alt="The Akiba rewards screen on a phone"
              className="hidden max-w-[210px] translate-y-6 sm:block"
            />
            <PhoneFrame
              src="/app/offers.webp"
              alt="A business offer with a reminder bell in the Akiba app"
              className="max-w-[250px] translate-y-3 sm:max-w-[270px]"
            />
          </div>
        </div>
      </Panel>

      {/* The five pillars, in detail. #how-it-works kept for old inbound links. */}
      <div id="how-it-works" className="scroll-mt-28">
        {pillars.map((pillar, index) => {
          const flipped = index % 2 === 1;
          const Icon = pillarIcons[pillar.id as keyof typeof pillarIcons];
          return (
            <Panel key={pillar.id} id={pillar.id} tone={flipped ? "card" : "white"}>
              <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                <div className={flipped ? "lg:order-2" : undefined}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-akiba-teal text-white">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <p className="font-sterling text-base font-medium text-akiba-teal">
                      <span className="tabular-nums opacity-50">{pillar.step}</span> ·{" "}
                      {pillar.eyebrow}
                    </p>
                  </div>
                  <h2 className="mt-5 font-sterling text-[2.35rem] font-medium leading-[1.05] tracking-[-0.015em] text-akiba-ink sm:text-[2.75rem]">
                    {pillar.title}
                  </h2>
                  <p className="mt-4 max-w-xl text-lg leading-8 text-akiba-muted">{pillar.body}</p>
                  <ul className="mt-7 space-y-3">
                    {pillar.points.map((point) => (
                      <li key={point} className="flex items-start gap-3 leading-7 text-akiba-ink">
                        <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-akiba-tint text-akiba-teal">
                          <Check className="h-3 w-3" aria-hidden="true" />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className={`flex justify-center gap-5 ${flipped ? "lg:order-1" : ""}`}>
                  <PhoneFrame src={pillar.image.src} alt={pillar.image.alt} />
                  {pillar.secondaryImage ? (
                    <PhoneFrame
                      src={pillar.secondaryImage.src}
                      alt={pillar.secondaryImage.alt}
                      className="hidden max-w-[218px] self-end xl:block"
                    />
                  ) : null}
                </div>
              </div>
            </Panel>
          );
        })}
      </div>

      {/* Merchant band */}
      <Panel tone="ink">
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <Eyebrow tone="onDark">{homeContent.merchantBand.eyebrow}</Eyebrow>
            <h2 className="mt-5 font-sterling text-[2.35rem] font-medium leading-[1.05] tracking-[-0.015em] sm:text-[2.75rem]">
              {homeContent.merchantBand.title}
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-white/70">
              {homeContent.merchantBand.body}
            </p>
          </div>
          <ButtonLink href="/merchants" variant="onDark" className="shrink-0">
            {homeContent.merchantBand.cta}
          </ButtonLink>
        </div>
      </Panel>

      {/* Mini-App strip */}
      <Panel tone="tint">
        <div className="grid items-center gap-8 lg:grid-cols-[1fr_auto]">
          <div>
            <Eyebrow>{homeContent.miniApp.eyebrow}</Eyebrow>
            <h2 className="mt-5 font-sterling text-3xl font-medium leading-[1.08] text-akiba-ink sm:text-4xl">
              {homeContent.miniApp.title}
            </h2>
            <p className="mt-4 max-w-2xl leading-7 text-akiba-muted">{homeContent.miniApp.body}</p>
          </div>
          <ButtonLink href={siteConfig.appUrl} variant="secondary" className="shrink-0">
            {homeContent.miniApp.cta}
          </ButtonLink>
        </div>
      </Panel>

      {/* FAQ */}
      <Panel tone="white">
        <SectionHeader
          eyebrow="FAQ"
          title="Got questions?"
          body="Tap a question to open it."
          align="center"
        />
        <FaqAccordion items={faqs} className="mt-12" />
        <div className="mt-10 flex flex-wrap justify-center gap-6">
          <Link
            href={siteConfig.passUrl}
            className="inline-flex items-center gap-2 text-sm font-semibold text-akiba-teal no-underline"
          >
            Get your Akiba Pass <ArrowUpRight className="h-4 w-4" />
          </Link>
          <Link
            href="/merchants"
            className="inline-flex items-center gap-2 text-sm font-semibold text-akiba-teal no-underline"
          >
            Become an Akiba merchant <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </Panel>
    </main>
  );
}
