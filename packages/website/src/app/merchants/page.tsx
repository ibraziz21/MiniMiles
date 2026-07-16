import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { PartnerLeadForm } from "@/components/PartnerLeadForm";
import { SectionHeader } from "@/components/SectionHeader";
import { partnerContent, siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Merchants",
  description:
    "Fund instant cashback on everyday spend. AkibaMiles gives your customers merchant-funded miles on every qualifying purchase — grocery, fuel, pharmacy, airtime. Pay only for real transactions.",
};

const merchantPartners = [
  { name: "Leshan Group", sub: "Electronics, accessories & repairs" },
];

const merchantIntentOptions = [
  "Grocery / supermarket",
  "Fuel / petrol station",
  "Pharmacy / health",
  "Fast food / restaurant",
  "Airtime / telecom",
  "Other retail",
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
            Turn every sale<br />
            <span className="text-akiba-teal">into the next visit.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-akiba-muted">
            Akiba Scan &amp; Award gives your customers instant Miles on every purchase — no hardware, no POS integration. Set your reward rate, scan at the counter, and watch repeat spend grow. You only pay on completed sales.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ButtonLink href={siteConfig.merchantUrl}>
              Get started
            </ButtonLink>
            <Link
              href="/merchants#contact"
              className="inline-flex items-center gap-2 text-sm font-semibold text-akiba-muted hover:text-akiba-ink"
            >
              Talk to us first <ArrowRight className="h-4 w-4" />
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
            eyebrow="How Scan & Award works"
            title="Their purchase becomes their reward. Instantly."
            body="Every qualifying purchase at your store earns the customer Miles the moment you scan their Akiba Pass — funded by you, delivered instantly, visible on their Pass before they leave the counter."
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
            title="Loyalty that pays for itself."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {[
              {
                title: "300K users already in the network",
                body: "Your cashback rewards appear in wallets your customers already use daily. No new app to download, no new account to create — they're already here.",
              },
              {
                title: "You set the rate. You control the cost.",
                body: "Define your reward rate, set qualifying spend thresholds, and cap your reward pool. Your loyalty budget is predictable — you pay per transaction, never a flat fee that doesn't scale.",
              },
              {
                title: "Portability builds the habit",
                body: "Miles earned at your store can be spent anywhere in the Akiba network. That portability is what makes customers choose you over a competitor — they're building a balance, not just chasing a one-time deal.",
              },
              {
                title: "Every reward accounted for.",
                body: "Every Mile issued and every redemption is recorded on a tamper-proof ledger. Your dashboard shows exactly what was issued, when, and against which sale — no black box.",
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
                    <div className="mt-4 flex items-baseline gap-1.5">
                      {plan.price.startsWith("Ksh ") ? (
                        <>
                          <span className={`font-sterling text-xl font-medium ${isPopular ? "text-white/70" : "text-akiba-muted"}`}>
                            Ksh
                          </span>
                          <span className={`font-sterling text-5xl font-semibold ${isPopular ? "text-white" : "text-akiba-ink"}`}>
                            {plan.price.replace("Ksh ", "")}
                          </span>
                        </>
                      ) : (
                        <span className={`font-sterling text-5xl font-semibold ${isPopular ? "text-white" : "text-akiba-ink"}`}>
                          {plan.price}
                        </span>
                      )}
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

          <div className="mt-10 flex justify-center">
            <ButtonLink href={siteConfig.merchantUrl}>Start onboarding</ButtonLink>
          </div>
        </div>
      </section>

      {/* Merchant lead form */}
      <section id="contact" className="scroll-mt-20 bg-akiba-ink px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl items-start gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="font-sterling text-base font-medium text-[#74D4DF]">
              Merchant intake
            </p>
            <h2 className="mt-3 font-sterling text-4xl font-medium leading-[1.08]">
              Reward your customers. Drive repeat spend.
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-8 text-white/65">
              Tell us your category, transaction volume, and loyalty goals. We&apos;ll come back with a clear setup path and what to expect from week one.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Scan & Award setup and dashboard onboarding",
                "M-Pesa and mobile-money purchase event integration",
                "Analytics, repeat-customer insights, and settlement reporting",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-sm text-white/75">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#74D4DF]" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-7 text-sm text-white/45">
              Questions?{" "}
              <a href={`mailto:${siteConfig.email}`} className="text-[#74D4DF] hover:underline">
                {siteConfig.email}
              </a>
            </p>
          </div>
          <PartnerLeadForm
            eyebrow="Merchant intake"
            title="Set up loyalty for your store"
            body="Share your store details and we will come back within 2 business days with a setup path, reward rate guidance, and onboarding options."
            source="website_merchants_page"
            intentLabel="Business type"
            intentOptions={merchantIntentOptions}
            messageLabel="Tell us about your store"
            messagePlaceholder="Example: We run a pharmacy chain in Nairobi with 3 locations. We process ~500 M-Pesa transactions per day and want to offer cashback to repeat customers. Include your transaction volume, category, and timing."
            submitLabel="Request merchant onboarding"
            successMessage="Thanks. We will review your details and follow up within 2 business days."
            className="shadow-none"
          />
        </div>
      </section>
    </main>
  );
}
