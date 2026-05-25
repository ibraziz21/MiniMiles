import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { SectionHeader } from "@/components/SectionHeader";
import { faqs, homeContent, siteConfig } from "@/content/site";

export default function HomePage() {
  return (
    <main>
      {/* Hero */}
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
              <ButtonLink href={siteConfig.appUrl}>{homeContent.hero.primaryCta}</ButtonLink>
              <ButtonLink href="/partners" variant="secondary">
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
                alt="AkibaMiles dashboard inside a MiniPay app mockup"
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

      {/* Three-audience section */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow={homeContent.audiences.eyebrow}
            title={homeContent.audiences.title}
            body={homeContent.audiences.body}
            align="center"
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {homeContent.audiences.cards.map((card) => (
              <article
                key={card.audience}
                className="flex flex-col justify-between rounded-lg border border-akiba-line bg-white p-6"
              >
                <div>
                  <div className="inline-flex rounded-full bg-akiba-tint px-3 py-1 text-xs font-semibold text-akiba-teal">
                    {card.audience}
                  </div>
                  <h2 className="mt-4 font-sterling text-2xl font-medium text-akiba-ink">
                    {card.title}
                  </h2>
                  <p className="mt-3 leading-7 text-akiba-muted">{card.body}</p>
                </div>
                <Link
                  href={card.href}
                  className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-akiba-teal"
                >
                  {card.cta} <ArrowUpRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Platform / product cards */}
      <section className="overflow-hidden bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow={homeContent.platform.eyebrow}
            title={homeContent.platform.title}
            body={homeContent.platform.body}
            align="center"
          />
          <div className="mt-10 flex justify-center overflow-hidden rounded-lg bg-white p-4">
            <Image
              src="/webflow/floating-icons.svg"
              width={823}
              height={255}
              alt="AkibaMiles ecosystem icons"
              className="min-w-[720px]"
            />
          </div>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            {homeContent.productCards.slice(0, 2).map((card) => (
              <article
                key={card.title}
                className="flex min-h-[520px] flex-col justify-between overflow-hidden rounded-lg bg-akiba-card p-8"
              >
                <div className="max-w-md">
                  <h3 className="font-sterling text-3xl font-medium text-akiba-ink">
                    {card.title}
                  </h3>
                  <p className="mt-3 leading-7 text-akiba-muted">{card.body}</p>
                </div>
                <Image
                  src={card.image}
                  width={card.image.includes("spend") ? 1212 : 600}
                  height={card.image.includes("spend") ? 902 : 1181}
                  alt={card.alt}
                  className={
                    card.image.includes("spend")
                      ? "mt-8 w-[760px] max-w-none self-center"
                      : "mt-8 max-h-[430px] w-auto self-center object-contain"
                  }
                />
              </article>
            ))}
            <article className="overflow-hidden rounded-lg bg-akiba-card p-8 lg:col-span-2">
              <div className="grid items-center gap-8 lg:grid-cols-[0.8fr_1fr]">
                <div>
                  <h3 className="font-sterling text-3xl font-medium text-akiba-ink">
                    {homeContent.productCards[2].title}
                  </h3>
                  <p className="mt-3 max-w-lg leading-7 text-akiba-muted">
                    {homeContent.productCards[2].body}
                  </p>
                </div>
                <Image
                  src={homeContent.productCards[2].image}
                  width={818}
                  height={748}
                  alt={homeContent.productCards[2].alt}
                  className="mx-auto max-h-[420px] w-auto object-contain"
                />
              </div>
            </article>
          </div>
        </div>
      </section>

      {/* Partner / project band */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-8 rounded-lg bg-akiba-ink p-8 text-white lg:grid-cols-[1fr_auto] lg:p-12">
          <div>
            <p className="font-sterling text-base font-medium text-[#74D4DF]">
              {homeContent.partnerBand.eyebrow}
            </p>
            <h2 className="mt-3 font-sterling text-4xl font-medium leading-[1.08]">
              {homeContent.partnerBand.title}
            </h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-white/75">
              {homeContent.partnerBand.body}
            </p>
          </div>
          <ButtonLink href="/partners" variant="secondary" className="bg-white shrink-0">
            Explore partners
          </ButtonLink>
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader title="Got questions?" body="Short answers about AkibaMiles." />
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
              href="/rewards"
              className="inline-flex items-center gap-2 text-sm font-semibold text-akiba-teal no-underline"
            >
              See how rewards work <ArrowUpRight className="h-4 w-4" />
            </Link>
            <Link
              href="/partners"
              className="inline-flex items-center gap-2 text-sm font-semibold text-akiba-teal no-underline"
            >
              Partner and campaign options <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
