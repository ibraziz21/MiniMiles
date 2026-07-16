import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { SectionHeader } from "@/components/SectionHeader";
import { faqs, homeContent, siteConfig } from "@/content/site";

export default function HomePage() {
  return (
    <main>
      {/* Hero — shopper-direct */}
      <section className="overflow-hidden bg-akiba-paper px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
        <div className="mx-auto grid w-full max-w-7xl items-center gap-10 lg:grid-cols-[0.92fr_1.08fr]">
          <div className="flex flex-col items-start gap-6">
            <div className="inline-flex rounded-full bg-akiba-tint px-4 py-2 text-sm font-semibold text-akiba-teal">
              {homeContent.hero.eyebrow}
            </div>
            <div className="space-y-5">
              <h1 className="font-sterling text-5xl font-medium leading-[1.02] text-akiba-ink sm:text-6xl">
                {homeContent.hero.title}
              </h1>
              <p className="max-w-xl text-lg leading-8 text-akiba-muted sm:text-xl">
                {homeContent.hero.body}
              </p>
            </div>
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <ButtonLink href={siteConfig.passUrl}>{homeContent.hero.primaryCta}</ButtonLink>
              <ButtonLink href="/merchants" variant="secondary">
                {homeContent.hero.secondaryCta}
              </ButtonLink>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[500px]">
            <div className="surface-grid relative overflow-hidden rounded-lg bg-akiba-card p-3 shadow-soft">
              <Image
                src="/webflow/hero-app.png"
                width={851}
                height={851}
                priority
                alt="Akiba Pass and rewards inside the app"
                className="h-auto w-full"
              />
            </div>
            <Image
              src="/webflow/floating-notification.svg"
              width={316}
              height={94}
              alt="Reward notification"
              className="absolute -left-4 top-5 hidden w-64 drop-shadow-xl sm:block"
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow={homeContent.howItWorks.eyebrow}
            title={homeContent.howItWorks.title}
            body={homeContent.howItWorks.body}
            align="center"
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {homeContent.howItWorks.steps.map((item) => (
              <article key={item.step} className="rounded-lg bg-akiba-card p-6">
                <p className="font-sterling text-5xl font-semibold text-akiba-teal opacity-25">
                  {item.step}
                </p>
                <h2 className="mt-4 font-sterling text-2xl font-medium text-akiba-ink">
                  {item.title}
                </h2>
                <p className="mt-3 leading-7 text-akiba-muted">{item.body}</p>
              </article>
            ))}
          </div>
          <div className="mt-8 flex justify-center">
            <ButtonLink href={siteConfig.passUrl}>{homeContent.hero.primaryCta}</ButtonLink>
          </div>
        </div>
      </section>

      {/* Merchant band */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-8 rounded-lg bg-akiba-ink p-8 text-white lg:grid-cols-[1fr_auto] lg:p-12">
          <div>
            <p className="font-sterling text-base font-medium text-[#74D4DF]">
              {homeContent.merchantBand.eyebrow}
            </p>
            <h2 className="mt-3 font-sterling text-4xl font-medium leading-[1.08]">
              {homeContent.merchantBand.title}
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-white/75">
              {homeContent.merchantBand.body}
            </p>
          </div>
          <ButtonLink href="/merchants" variant="secondary" className="shrink-0 bg-white">
            {homeContent.merchantBand.cta}
          </ButtonLink>
        </div>
      </section>

      {/* Mini-App strip */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-8 rounded-lg border border-akiba-line bg-akiba-card p-8 lg:grid-cols-[1fr_auto] lg:p-12">
          <div>
            <p className="font-sterling text-base font-medium text-akiba-teal">
              {homeContent.miniApp.eyebrow}
            </p>
            <h2 className="mt-3 font-sterling text-4xl font-medium leading-[1.08] text-akiba-ink">
              {homeContent.miniApp.title}
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-akiba-muted">
              {homeContent.miniApp.body}
            </p>
          </div>
          <ButtonLink href={siteConfig.appUrl} className="shrink-0">
            {homeContent.miniApp.cta}
          </ButtonLink>
        </div>
      </section>

      {/* Proof stats */}
      <section className="bg-akiba-paper px-4 py-14 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-5xl gap-6 text-center sm:grid-cols-3">
          {homeContent.proofStats.map((stat) => (
            <div key={stat.label}>
              <p className="font-sterling text-5xl font-semibold text-akiba-ink">{stat.value}</p>
              <p className="mt-2 text-sm font-medium text-akiba-muted">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader title="Got questions?" body="Short answers about Akiba." />
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {faqs.map((item) => (
              <div key={item.question} className="rounded-lg border border-akiba-line bg-white p-6">
                <h3 className="font-sterling text-xl font-medium text-akiba-ink">
                  {item.question}
                </h3>
                <p className="mt-3 leading-7 text-akiba-muted">{item.answer}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 flex flex-wrap gap-6">
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
        </div>
      </section>
    </main>
  );
}
