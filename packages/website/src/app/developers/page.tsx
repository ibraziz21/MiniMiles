import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  BarChart3,
  Check,
  Gift,
  ScanLine,
  Store,
  Ticket,
  Webhook,
} from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { SectionHeader } from "@/components/SectionHeader";
import { siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Voucher and Loyalty API for Merchants",
  description:
    "Create, distribute, and redeem merchant vouchers with the AkibaMiles API. Connect your checkout, POS, or customer platform and track every redemption.",
};

const apiCapabilities = [
  {
    icon: Ticket,
    title: "Generate voucher codes",
    body: "Create unique voucher codes with a clear description, Miles value, and expiry. Akiba returns the code immediately so your system can distribute it.",
    endpoints: ["POST /api/v1/vouchers/issue"],
  },
  {
    icon: Gift,
    title: "Distribute vouchers",
    body: "Deliver issued codes through your existing CRM, checkout, campaign, or customer-support workflow—without moving customers into a separate tool.",
    endpoints: ["POST /api/v1/vouchers/issue"],
  },
  {
    icon: ScanLine,
    title: "Redeem at checkout",
    body: "Validate and redeem a code from your POS or online checkout. Each redemption is recorded once, with a clear result your team can act on immediately.",
    endpoints: ["POST /api/v1/vouchers/:code/redeem"],
  },
  {
    icon: Store,
    title: "Publish your rewards catalog",
    body: "Make active rewards available to customers and keep each item's Miles cost and stock visible anywhere you embed your catalog.",
    endpoints: ["GET /api/v1/catalog/:merchantSlug"],
  },
  {
    icon: BarChart3,
    title: "Reward customer purchases",
    body: "Issue Miles after a qualifying purchase and connect loyalty to the payment or order events your business already records.",
    endpoints: ["POST /api/v1/rewards/issue"],
  },
  {
    icon: Webhook,
    title: "Track outcomes",
    body: "Use signed webhooks and dashboard reporting to follow voucher issuance, redemption, customer activity, and campaign performance.",
    endpoints: ["GET /api/v1/webhooks", "GET /api/v1/catalog/analytics"],
  },
];

const integrationOptions = [
  {
    eyebrow: "No code",
    title: "Merchant dashboard",
    body: "Create voucher types, issue rewards, manage branches, and review redemptions from a self-serve dashboard.",
    cta: "Open merchant dashboard",
    href: siteConfig.merchantUrl,
  },
  {
    eyebrow: "Direct integration",
    title: "Voucher API",
    body: "Connect voucher issuance and redemption directly to your POS, checkout, CRM, or backend services.",
    cta: "Request API access",
    href: `mailto:${siteConfig.email}?subject=Merchant%20Voucher%20API%20Access`,
  },
  {
    eyebrow: "Flexible",
    title: "Dashboard + API",
    body: "Let your team manage offers in the dashboard while your systems handle distribution and redemption through the API.",
    cta: "See API capabilities",
    href: "/developers#capabilities",
  },
];

const issueExample = `POST /api/v1/vouchers/issue
Authorization: Bearer ak_live_xxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
Idempotency-Key: issue_order_1042

{
  "description": "500 Miles off the next purchase",
  "milesValue": 500,
  "expiresAt": "2026-12-31T23:59:59Z"
}`;

const redeemExample = `POST /api/v1/vouchers/AKIBA-WELCOME-10/redeem
Authorization: Bearer ak_live_xxxxxxxxxxxxxxxxxxxx
Content-Type: application/json
Idempotency-Key: redeem_order_1179

{
  "redeemedBy": "customer_123"
}`;

export default function DevelopersPage() {
  return (
    <main>
      {/* Hero */}
      <section className="overflow-hidden bg-akiba-ink px-4 py-16 text-white sm:px-6 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-[#74D4DF]">
            Akiba Merchant API · REST
          </div>
          <h1 className="mt-6 font-sterling text-5xl font-medium leading-[1.02] sm:text-6xl">
            Vouchers that move<br />from campaign to checkout.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/65">
            Create voucher offers, distribute unique codes to customers, redeem them in-store or online, and track every result from one merchant-focused API.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ButtonLink href={siteConfig.merchantUrl} className="bg-akiba-teal text-white hover:bg-akiba-teal/90">
              Open merchant dashboard
            </ButtonLink>
            <Link
              href="/developers#capabilities"
              className="inline-flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white"
            >
              Explore the API <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
          <p className="mt-5 text-sm text-white/45">Dashboard signup is self-serve.</p>
        </div>
      </section>

      {/* Integration paths */}
      <section id="integration" className="scroll-mt-20 border-b border-akiba-line bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Choose your setup"
            title="Start in the dashboard. Integrate when you need to."
            body="Run the full voucher workflow without code, connect it to your existing systems, or use both together."
            align="center"
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {integrationOptions.map((option) => (
              <article key={option.title} className="flex flex-col rounded-xl border border-akiba-line bg-akiba-paper p-6">
                <p className="text-xs font-semibold uppercase tracking-widest text-akiba-teal">{option.eyebrow}</p>
                <h2 className="mt-3 font-sterling text-2xl font-medium text-akiba-ink">{option.title}</h2>
                <p className="mt-3 flex-1 text-sm leading-7 text-akiba-muted">{option.body}</p>
                <Link href={option.href} className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-akiba-teal no-underline">
                  {option.cta} <ArrowUpRight className="h-4 w-4" />
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* API capabilities */}
      <section id="capabilities" className="scroll-mt-20 bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Merchant API"
            title="The voucher workflow, end to end."
            body="Manage the offer in Akiba, connect distribution to the tools you already use, and make redemption simple for customers and staff."
            align="center"
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {apiCapabilities.map((capability) => {
              const Icon = capability.icon;
              return (
                <article key={capability.title} className="flex flex-col rounded-xl border border-akiba-line bg-white p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-akiba-tint">
                      <Icon className="h-5 w-5 text-akiba-teal" />
                    </div>
                    <h2 className="font-sterling text-xl font-medium text-akiba-ink">{capability.title}</h2>
                  </div>
                  <p className="mt-4 flex-1 text-sm leading-7 text-akiba-muted">{capability.body}</p>
                  <div className="mt-5 space-y-1.5">
                    {capability.endpoints.map((endpoint) => (
                      <code key={endpoint} className="block rounded bg-akiba-paper px-2.5 py-1.5 text-xs text-akiba-teal">
                        {endpoint}
                      </code>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Auth model */}
      <section id="auth" className="scroll-mt-20 border-b border-akiba-line bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            <div>
              <SectionHeader
                eyebrow="Integration basics"
                title="One partner key. Safe repeat requests."
                body="Your integration receives a scoped API key. Idempotency keys protect voucher issuance and redemption from accidental duplicates, while signed webhooks keep your systems updated."
              />
              <ul className="mt-8 space-y-4">
                {[
                  { label: "Scoped access", detail: "A partner key connected only to your merchant account." },
                  { label: "Duplicate protection", detail: "Idempotency keys make retries safe at checkout." },
                  { label: "Signed updates", detail: "Authenticated webhooks for events your backend needs." },
                  { label: "Clear responses", detail: "Structured JSON results and consistent error codes." },
                ].map((item) => (
                  <li key={item.label} className="flex items-start gap-3">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-akiba-teal" />
                    <div>
                      <span className="font-medium text-akiba-ink">{item.label}</span>
                      <span className="ml-2 text-sm text-akiba-muted">{item.detail}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="space-y-4">
              <div className="overflow-hidden rounded-xl bg-akiba-ink">
                <div className="border-b border-white/10 px-4 py-2.5">
                  <span className="text-xs font-semibold uppercase tracking-widest text-white/40">Issue a voucher</span>
                </div>
                <pre className="overflow-x-auto px-5 py-4 text-xs leading-6 text-[#74D4DF]">
                  <code>{issueExample}</code>
                </pre>
              </div>
              <div className="overflow-hidden rounded-xl bg-akiba-ink">
                <div className="border-b border-white/10 px-4 py-2.5">
                  <span className="text-xs font-semibold uppercase tracking-widest text-white/40">Redeem at checkout</span>
                </div>
                <pre className="overflow-x-auto px-5 py-4 text-xs leading-6 text-[#74D4DF]">
                  <code>{redeemExample}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Use cases */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Built for merchant operations"
            title="Easy for your systems. Easy for your staff."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              {
                title: "Targeted distribution",
                body: "Issue a welcome, win-back, or spend-based voucher from the customer and campaign tools you already use.",
              },
              {
                title: "In-store redemption",
                body: "Validate a code at the counter, connect it to a branch and order, and give staff a clear success or failure result.",
              },
              {
                title: "Online checkout",
                body: "Apply Akiba vouchers inside your existing checkout and record redemption without sending customers through another flow.",
              },
            ].map((item) => (
              <article key={item.title} className="rounded-xl border border-akiba-line bg-white p-6">
                <h2 className="font-sterling text-xl font-medium text-akiba-ink">{item.title}</h2>
                <p className="mt-3 text-sm leading-7 text-akiba-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section id="contact" className="scroll-mt-20 bg-akiba-ink px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <p className="font-sterling text-base font-medium text-[#74D4DF]">Get started</p>
          <h2 className="mt-3 font-sterling text-4xl font-medium leading-[1.08]">
            Start with your first voucher.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg leading-8 text-white/65">
            Create your merchant account and manage vouchers immediately from the dashboard. When you&apos;re ready to connect distribution or redemption to your own systems, request a partner API key.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ButtonLink href={siteConfig.merchantUrl} className="bg-akiba-teal text-white hover:bg-akiba-teal/90">
              Open merchant dashboard
            </ButtonLink>
            <ButtonLink
              href={`mailto:${siteConfig.email}?subject=Merchant%20Voucher%20API%20Access`}
              variant="secondary"
              className="border-white/20 text-white hover:bg-white/10"
            >
              Request API access
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm text-white/40">
            Dashboard signup is self-serve. We respond to API access requests within 2 business days.
          </p>
        </div>
      </section>
    </main>
  );
}
