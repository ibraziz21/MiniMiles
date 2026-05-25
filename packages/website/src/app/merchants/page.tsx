import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { SectionHeader } from "@/components/SectionHeader";
import { partnerContent, siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Merchants",
  description:
    "List your products on AkibaMiles. Get customers delivered through games and rewards. Fulfil orders from one dashboard. Get paid monthly via crypto, bank, or M-Pesa. From $20/mo.",
};

const merchantPartners = [
  { name: "Leshan", sub: "Retail partner" },
];

export default function MerchantsPage() {
  const { merchant } = partnerContent;

  return (
    <main>
      {/* Hero */}
      <section className="overflow-hidden bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex rounded-full bg-akiba-tint px-4 py-2 text-sm font-semibold text-akiba-teal">
            {merchant.eyebrow}
          </div>
          <h1 className="mt-6 font-sterling text-5xl font-medium leading-[1.02] text-akiba-ink sm:text-6xl">
            Sell more.<br />
            <span className="text-akiba-teal">Get paid your way.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-akiba-muted">
            {merchant.body}
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ButtonLink href="/merchants#pricing">
              See pricing plans
            </ButtonLink>
            <Link
              href="/merchants#how-it-works"
              className="inline-flex items-center gap-2 text-sm font-semibold text-akiba-muted hover:text-akiba-ink"
            >
              How it works <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Merchant partner logos */}
      <section className="border-b border-akiba-line bg-white px-4 py-10 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <p className="text-center text-xs font-semibold uppercase tracking-widest text-akiba-muted">
            Merchants already on the platform
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-8 md:gap-14">
            {merchantPartners.map((p) => (
              <div key={p.name} className="flex flex-col items-center gap-1">
                <span className="font-sterling text-2xl font-semibold text-akiba-ink">{p.name}</span>
                <span className="text-xs text-akiba-muted">{p.sub}</span>
              </div>
            ))}
            <div className="flex flex-col items-center gap-1 opacity-40">
              <span className="font-sterling text-2xl font-medium text-akiba-muted">Your store</span>
              <span className="text-xs text-akiba-muted">Could be here</span>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-20 bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="One service. Three ways we bring you customers."
            title="We bring the customers. You keep the margin."
            body="190K+ active wallets already engage with AkibaMiles. Games and vouchers send them to your products — no cold acquisition, no ad spend."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {merchant.howItWorks.map((item) => (
              <article key={item.step} className="rounded-lg bg-white p-6">
                <p className="font-sterling text-5xl font-semibold text-akiba-teal opacity-25">{item.step}</p>
                <h3 className="mt-4 font-sterling text-xl font-medium text-akiba-ink">{item.title}</h3>
                <p className="mt-2 text-sm leading-7 text-akiba-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Why merchants sign up */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Why merchants sign up"
            title="You control the offer. We handle the rest."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {[
              {
                title: "A customer base, ready-made",
                body: "190K+ wallets already engage with AkibaMiles. Vouchers and the Claw Game send motivated buyers to your products — no ad spend, no cold acquisition.",
              },
              {
                title: "You control the offer",
                body: "Set your own pricing, discounts, and supply. Run promotions when it suits you. No forced markdowns, no race to the bottom.",
              },
              {
                title: "Fulfilment, handled",
                body: "Accept, pack, dispatch, and deliver from one dashboard — with status tracking, timestamps, and full audit trails built in.",
              },
              {
                title: "Get paid, your way",
                body: "Automatic monthly payouts to a crypto wallet, your bank, or M-Pesa — with full receipts and order exports for your books.",
              },
            ].map((item) => (
              <article key={item.title} className="rounded-lg border border-akiba-line p-6">
                <h3 className="font-sterling text-xl font-medium text-akiba-ink">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-akiba-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow={merchant.pricing.note}
            title="Pick a plan. Only pay more when you sell more."
            body="The service fee only applies to orders that complete. No sales, no service fee."
            align="center"
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {merchant.pricing.plans.map((plan) => {
              const isPopular = plan.tier === "Most popular";
              return (
                <article
                  key={plan.name}
                  className={`flex flex-col rounded-lg p-6 ${
                    isPopular
                      ? "bg-akiba-ink text-white ring-2 ring-akiba-teal"
                      : "border border-akiba-line bg-white"
                  }`}
                >
                  <div>
                    <span className={`text-xs font-semibold uppercase tracking-widest ${isPopular ? "text-[#74D4DF]" : "text-akiba-teal"}`}>
                      {plan.tier}
                    </span>
                    <p className={`mt-1 font-sterling text-2xl font-medium ${isPopular ? "text-white" : "text-akiba-ink"}`}>
                      {plan.name}
                    </p>
                    <div className="mt-4 flex items-baseline gap-1">
                      <span className={`font-sterling text-5xl font-semibold ${isPopular ? "text-white" : "text-akiba-ink"}`}>
                        {plan.price}
                      </span>
                      <span className={`text-sm ${isPopular ? "text-white/60" : "text-akiba-muted"}`}>/mo</span>
                    </div>
                    <div className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-medium ${isPopular ? "bg-white/10 text-white/80" : "bg-akiba-tint text-akiba-teal"}`}>
                      {plan.fee}
                    </div>
                  </div>
                  <ul className="mt-6 flex-1 space-y-3">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm">
                        <Check className={`mt-0.5 h-4 w-4 shrink-0 ${isPopular ? "text-[#74D4DF]" : "text-akiba-teal"}`} />
                        <span className={isPopular ? "text-white/80" : "text-akiba-muted"}>{f}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          <p className="mt-5 text-center text-sm text-akiba-muted">{merchant.pricing.footnote}</p>

          {/* Payout methods */}
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <span className="text-sm font-medium text-akiba-muted">Get paid via:</span>
            {merchant.payoutMethods.map((method) => (
              <span key={method} className="rounded-full border border-akiba-line bg-white px-4 py-1.5 text-sm font-medium text-akiba-ink">
                {method}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-akiba-ink px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-sterling text-4xl font-medium leading-[1.08]">
            List your products.<br />Get customers. Grow.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-white/65">
            Pick a plan and set up your store. We&apos;ll handle the customer pipeline — you handle the product.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ButtonLink href={`mailto:${siteConfig.email}`} className="bg-white text-akiba-ink hover:bg-white/90">
              Become a merchant partner
            </ButtonLink>
          </div>
          <p className="mt-5 text-sm text-white/40">
            Questions?{" "}
            <a href={`mailto:${siteConfig.email}`} className="text-[#74D4DF] hover:underline">
              {siteConfig.email}
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
