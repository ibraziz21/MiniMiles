import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, BellRing, Check, Heart, QrCode, Store, Ticket } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { Eyebrow } from "@/components/Eyebrow";
import { FaqAccordion } from "@/components/FaqAccordion";
import { Panel } from "@/components/Panel";
import { PartnerLeadForm } from "@/components/PartnerLeadForm";
import { SectionHeader } from "@/components/SectionHeader";
import { SubscriptionPlans } from "@/components/SubscriptionPlans";
import { partnerContent, siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Merchants",
  description:
    "Get discovered by shoppers near you and earn the second visit. Rewards at the counter, vouchers, offer days with reminders, and recommendations only real customers can leave. No hardware, no POS integration.",
};

const merchantPartners = [
  { name: "Arabica Coffee House", sub: "Food & drink" },
  { name: "Lababa Desserts", sub: "Desserts & bakery" },
  { name: "Leshan Group", sub: "Electronics, accessories & repairs" },
];

const surfaceIcons = {
  storefront: Store,
  counter: QrCode,
  vouchers: Ticket,
  offers: BellRing,
  recommendations: Heart,
} as const;

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
      <Panel tone="wash" bare>
        <div className="mx-auto max-w-4xl px-5 py-14 text-center sm:px-10 sm:py-20 lg:py-24">
          <Eyebrow>{merchant.eyebrow}</Eyebrow>
          <h1 className="mt-6 font-sterling text-[2.9rem] font-medium leading-[1.02] tracking-[-0.02em] text-akiba-ink sm:text-6xl">
            Get found.<br />
            <span className="text-akiba-teal">Then get them back.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-akiba-muted">
            Akiba puts your business in front of shoppers searching for what you sell, then gives you the tools to earn the second visit: rewards at the counter, vouchers and free offers, scheduled offer days with reminders, and recommendations from customers we can verify. No hardware, no POS integration.
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

          <div className="mt-12 border-t border-akiba-line/70 pt-8">
            <p className="text-xs font-semibold uppercase tracking-widest text-akiba-muted">
              Businesses already on Akiba
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
              {merchantPartners.map((p) => (
                <div key={p.name} className="flex flex-col items-center gap-0.5">
                  <span className="font-sterling text-xl font-semibold text-akiba-ink">{p.name}</span>
                  <span className="text-xs text-akiba-muted">{p.sub}</span>
                </div>
              ))}
              <div className="flex flex-col items-center gap-0.5 opacity-40">
                <span className="font-sterling text-xl font-medium text-akiba-muted">Your business</span>
                <span className="text-xs text-akiba-muted">Could be here</span>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      {/* What a merchant account gives you */}
      <Panel id="what-you-get" tone="white">
        <SectionHeader
          eyebrow="What you get"
          title="A storefront, a retention engine and a review channel, in one account."
          body="Everything a shopper sees in Akiba, run from your dashboard."
        />
        <div className="mt-10 grid gap-3 md:grid-cols-2">
          {merchant.surfaces.map((item) => {
            const Icon = surfaceIcons[item.icon as keyof typeof surfaceIcons];
            return (
              <article
                key={item.title}
                className="flex gap-4 rounded-2xl border border-akiba-line bg-akiba-paper p-4 sm:p-5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-akiba-teal text-white">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="font-sterling text-lg font-medium leading-snug text-akiba-ink">
                    {item.title}
                  </h3>
                  <p className="mt-1.5 text-sm leading-6 text-akiba-muted">{item.body}</p>
                </div>
              </article>
            );
          })}
        </div>
      </Panel>

      {/* How it works */}
      <Panel id="how-it-works" tone="card">
        <SectionHeader
          eyebrow="How Scan & Award works"
          title="Their purchase becomes their reason to return."
          body="Scan their Pass at the till. Miles land before they leave."
        />
        <ol className="mt-10 grid overflow-hidden rounded-2xl bg-white md:grid-cols-3">
          {merchant.howItWorks.map((item) => (
            <li
              key={item.step}
              className="flex gap-4 border-b border-akiba-line p-5 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-akiba-tint font-sterling text-sm font-semibold tabular-nums text-akiba-teal">
                {item.step}
              </span>
              <div>
                <h3 className="font-sterling text-lg font-medium leading-snug text-akiba-ink">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-akiba-muted">{item.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {/* Why merchants sign up */}
      <Panel tone="white">
        <SectionHeader
          eyebrow="Why businesses sign up"
          title="Discovery and retention that pay for themselves."
        />
        <div className="mt-10 grid gap-3 md:grid-cols-2">
          {merchant.reasons.map((item) => (
            <article
              key={item.title}
              className="flex gap-3.5 rounded-2xl border border-akiba-line bg-akiba-paper p-4 sm:p-5"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-akiba-tint text-akiba-teal">
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-sterling text-lg font-medium leading-snug text-akiba-ink">
                  {item.title}
                </h3>
                <p className="mt-1.5 text-sm leading-6 text-akiba-muted">{item.body}</p>
              </div>
            </article>
          ))}
        </div>
      </Panel>

      {/* Pricing */}
      <Panel id="pricing" tone="card">
        <SectionHeader
          eyebrow={merchant.pricing.note}
          title="Choose a plan that fits your monthly activity."
          body="Every plan includes a monthly Miles allowance, voucher tools and branch access."
          align="center"
        />
        <SubscriptionPlans plans={merchant.pricing.plans} merchantUrl={siteConfig.merchantUrl} />
        <p className="mt-5 text-center text-sm text-akiba-muted">{merchant.pricing.footnote}</p>

        <div className="mt-16">
          <SectionHeader
            eyebrow="Billing and usage"
            title="Know exactly how your plan works."
            align="center"
          />
          <FaqAccordion items={merchant.pricing.faqs} className="mt-10" />
        </div>

        <div className="mt-10 flex justify-center">
          <ButtonLink href={siteConfig.merchantUrl}>Start onboarding</ButtonLink>
        </div>
      </Panel>

      {/* Merchant lead form */}
      <Panel id="contact" tone="ink">
        <div className="grid items-start gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <Eyebrow tone="onDark">Merchant intake</Eyebrow>
            <h2 className="mt-5 font-sterling text-[2.35rem] font-medium leading-[1.05] tracking-[-0.015em] sm:text-[2.75rem]">
              Reward your customers. Drive repeat spend.
            </h2>
            <p className="mt-4 max-w-xl text-lg leading-8 text-white/65">
              Tell us your category, your volume, and what you want out of it. We&apos;ll come back with a setup path and what to expect from week one.
            </p>
            <ul className="mt-7 space-y-3">
              {[
                "Merchant profile, branches and opening hours published to Explore",
                "Scan & Award setup, voucher and offer-day configuration",
                "M-Pesa and mobile-money purchase event integration",
                "Analytics, repeat-customer insights, and Miles usage reporting",
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
            title="Get your business on Akiba"
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
      </Panel>
    </main>
  );
}
