import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { PartnerLeadForm } from "@/components/PartnerLeadForm";
import { SectionHeader } from "@/components/SectionHeader";
import { partnerContent } from "@/content/site";

export const metadata: Metadata = {
  title: "Partners",
  description:
    "Run quest campaigns and sponsored raffles that build repeat on-chain activity. Start with a $100 7-day Growth Test. 1.39M+ quest claims. 190K+ registered wallets.",
};

const campaignPartners = [
  {
    name: "MiniPay",
    sub: "Wallet campaign partner",
    logo: "/Logo on white.png",
    width: 1024,
    height: 1024,
    imageClassName: "h-20 w-20 object-contain",
  },
  {
    name: "Web3 Mashinani",
    sub: "Community campaign partner",
    logo: "/WMLogo.svg",
    width: 459,
    height: 143,
    imageClassName: "h-14 w-auto object-contain",
  },
  {
    name: "CeloPG",
    sub: "Public goods partner",
    logo: "/celopg.png",
    width: 2048,
    height: 2048,
    imageClassName: "h-20 w-20 rounded-full object-contain",
  },
];

const partnerIntentOptions = [
  "$100 Growth Test",
  "Full Campaign",
  "Partner Quests",
  "Sponsored Raffle",
  "Not sure yet",
];

export default function PartnersPage() {
  const { project } = partnerContent;

  return (
    <main>
      {/* Hero */}
      <section className="overflow-hidden bg-akiba-ink px-4 py-16 text-white sm:px-6 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-[#74D4DF]">
            {project.eyebrow}
          </div>
          <h1 className="mt-6 font-sterling text-5xl font-medium leading-[1.02] sm:text-6xl">
            {project.title}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/65">
            {project.body}
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ButtonLink href="/partners#contact" className="bg-akiba-teal text-white hover:bg-akiba-teal/90">
              Start a $100 Growth Test
            </ButtonLink>
            <Link
              href="/partners#results"
              className="inline-flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white"
            >
              See live results <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Partner logos */}
      <section className="border-b border-akiba-line bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-akiba-muted">
            Previous campaign partners
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {campaignPartners.map((p) => (
              <article
                key={p.name}
                className="flex min-h-40 flex-col items-center justify-between rounded-lg border border-akiba-line bg-akiba-paper p-5 text-center"
              >
                <div className="flex h-24 w-full items-center justify-center">
                  <Image
                    src={p.logo}
                    width={p.width}
                    height={p.height}
                    alt={`${p.name} logo`}
                    className={p.imageClassName}
                  />
                </div>
                <div>
                  <h2 className="font-sterling text-xl font-semibold text-akiba-ink">{p.name}</h2>
                  <p className="mt-1 text-xs text-akiba-muted">{p.sub}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Live results */}
      <section id="results" className="scroll-mt-20 bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Live campaigns. Real numbers."
            title="This isn't a pitch. These are results."
            body={project.problem}
          />
          <div className="mt-10 grid grid-cols-2 gap-4 md:grid-cols-4">
            {project.proofStats.map((stat) => (
              <div key={stat.label} className="rounded-lg border border-akiba-line bg-white p-6">
                <p className="font-sterling text-4xl font-semibold text-akiba-teal">{stat.value}</p>
                <p className="mt-2 text-sm leading-6 text-akiba-muted">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why it works differently */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Why it works"
            title="We don't pay users. We engage them."
            body="More engagement per dollar spent. That's the only metric that matters when you're allocating a reward budget."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {project.differentiators.map((item) => (
              <article key={item.title} className="rounded-lg border border-akiba-line p-6">
                <h3 className="font-sterling text-xl font-medium text-akiba-ink">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-akiba-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Campaign mechanics */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="What we offer"
            title="Three campaign mechanics. One integrated system."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {project.mechanics.map((mechanic) => (
              <article key={mechanic.name} className="rounded-lg bg-white p-6">
                <span className="text-xs font-semibold uppercase tracking-widest text-akiba-teal">
                  {mechanic.tag}
                </span>
                <h3 className="mt-2 font-sterling text-2xl font-medium text-akiba-ink">{mechanic.name}</h3>
                <p className="mt-3 text-sm leading-7 text-akiba-muted">{mechanic.body}</p>
                <ul className="mt-5 space-y-2">
                  {mechanic.bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2.5 text-sm text-akiba-muted">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-akiba-teal" />
                      {b}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          {/* KPI chips */}
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-akiba-muted">KPIs we move:</span>
            {project.kpis.map((kpi) => (
              <span key={kpi} className="rounded-full border border-akiba-line bg-white px-4 py-1.5 text-sm font-medium text-akiba-ink">
                {kpi}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing + CTA */}
      <section id="contact" className="scroll-mt-20 bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Two paths. One direction."
            title="Start small. Scale on signal."
            body="Validate with a $100 7-day test before committing to a full campaign. Every campaign gives you benchmark data for the next."
            align="center"
          />
          <div className="mx-auto mt-10 grid max-w-3xl gap-5 md:grid-cols-2">
            {project.pilotPricing.map((plan) => (
              <article
                key={plan.name}
                className={`flex flex-col rounded-lg p-6 ${
                  plan.popular
                    ? "bg-akiba-ink text-white ring-2 ring-akiba-teal"
                    : "border border-akiba-line bg-akiba-paper"
                }`}
              >
                <span className={`text-xs font-semibold uppercase tracking-widest ${plan.popular ? "text-[#74D4DF]" : "text-akiba-teal"}`}>
                  {plan.tier}
                </span>
                <p className={`mt-1 font-sterling text-2xl font-medium ${plan.popular ? "text-white" : "text-akiba-ink"}`}>
                  {plan.name}
                </p>
                <p className={`mt-4 font-sterling text-5xl font-semibold ${plan.popular ? "text-white" : "text-akiba-ink"}`}>
                  {plan.price}
                </p>
                <p className={`mt-1 text-sm ${plan.popular ? "text-white/60" : "text-akiba-muted"}`}>{plan.priceNote}</p>
                <ul className="mt-6 flex-1 space-y-2.5">
                  {plan.features.map((f, i) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${plan.popular ? "text-[#74D4DF]" : "text-akiba-teal"}`} />
                      <span className={`${plan.popular ? "text-white/80" : "text-akiba-muted"} ${i === 0 ? "font-medium" : ""}`}>{f}</span>
                    </li>
                  ))}
                </ul>
                {plan.note && (
                  <p className={`mt-6 text-xs leading-5 ${plan.popular ? "text-white/40" : "text-akiba-muted/60"}`}>{plan.note}</p>
                )}
              </article>
            ))}
          </div>
          <p className="mt-5 text-center text-sm text-akiba-muted">{project.pilotFootnote}</p>

          <div className="mt-12 grid items-start gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <aside className="rounded-lg bg-akiba-ink p-6 text-white lg:sticky lg:top-24">
              <p className="font-sterling text-base font-medium text-[#74D4DF]">
                Campaign intake
              </p>
              <h3 className="mt-3 font-sterling text-3xl font-medium leading-tight">
                Tell us the KPI. We will shape the campaign.
              </h3>
              <p className="mt-4 text-sm leading-7 text-white/65">
                Use the form for growth tests, full campaigns, raffles, or a
                custom partner quest. The first reply focuses on campaign
                mechanics, expected user actions, and reporting.
              </p>
              <ul className="mt-6 space-y-3">
                {[
                  "Target action and wallet segment",
                  "Reward structure and campaign window",
                  "Reporting metrics for D7, D14, and D30",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-white/75">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#74D4DF]" />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-6 text-sm text-white/45">
                Prefer email?{" "}
                <a href={`mailto:${partnerContent.form.email}`} className="text-[#74D4DF] hover:underline">
                  {partnerContent.form.email}
                </a>
              </p>
            </aside>
            <PartnerLeadForm
              eyebrow="Lead generation"
              title="Start a partner campaign"
              body="Share the basics and we will come back with a growth-test or full-campaign structure."
              source="website_partners_page"
              intentOptions={partnerIntentOptions}
              messageLabel="Campaign brief"
              messagePlaceholder="Example: We want MiniPay users to swap, deposit, bridge, hold, or return daily. Include target countries, budget range, timing, and any KPI that matters."
              submitLabel="Request campaign plan"
              successMessage="Thanks. We will review your campaign inquiry and follow up."
              className="h-full"
            />
          </div>
        </div>
      </section>
    </main>
  );
}
