import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Check, Terminal, Webhook, Zap, BarChart3, Shield, Code2 } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { SectionHeader } from "@/components/SectionHeader";
import { siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Developers",
  description:
    "Embed the full AkibaMiles loyalty stack into your app via REST API. Partner keys, HMAC-signed webhooks, tiered rate limits. Quests, events, rewards, campaigns — all programmable.",
};

const apiCapabilities = [
  {
    icon: Terminal,
    title: "Quests",
    body: "Create executable, rewardable user actions. Define verification rules, reward rules, and lifecycle transitions (draft → active → paused → archived). Each completion writes to an immutable ledger.",
    endpoints: ["POST /v1/quests", "POST /v1/quests/:id/verify", "GET /v1/quests/:id/analytics"],
  },
  {
    icon: Zap,
    title: "Events",
    body: "Push arbitrary user events into the Akiba pipeline. Events fire quest triggers automatically — idempotent by SHA-256 hash of (eventType, questId, walletAddress, occurredAt).",
    endpoints: ["POST /v1/events", "POST /v1/events/batch", "GET /v1/events/summary"],
  },
  {
    icon: BarChart3,
    title: "Campaigns & Raffles",
    body: "Create raffle containers, attach quest gates for eligibility, check wallet eligibility, and manage campaign lifecycle. Entry is gated by quest completion — casual claimers excluded by design.",
    endpoints: ["POST /v1/campaigns", "PUT /v1/campaigns/:id/quest-gates", "GET /v1/campaigns/:id/eligibility"],
  },
  {
    icon: Code2,
    title: "Rewards & Miles",
    body: "Issue, distribute, and claim Miles programmatically. Track balance per wallet, bulk distribute to a cohort, and confirm onchain claim transactions. All issuance is recorded on the immutable miles ledger.",
    endpoints: ["POST /v1/rewards/issue", "POST /v1/rewards/distribute/bulk", "GET /v1/rewards/balance/:wallet"],
  },
  {
    icon: Webhook,
    title: "Webhooks",
    body: "Receive push notifications for quest verifications from your own backend. HMAC-SHA256 signed, timestamp-validated (±300 s), idempotency key required. Replay-safe by design.",
    endpoints: ["POST /v1/webhooks/partners/:slug", "GET /v1/webhooks"],
  },
  {
    icon: Shield,
    title: "Vouchers & Catalog",
    body: "Issue voucher codes, manage a merchant catalog, and process redemptions. Full audit trail: every code issued and every redemption linked to a wallet and timestamp.",
    endpoints: ["POST /v1/vouchers/issue", "POST /v1/vouchers/:code/redeem", "GET /v1/catalog/:merchantSlug"],
  },
];

const rateTiers = [
  {
    tier: "Starter",
    limit: "60 req / min",
    description: "Validate your integration and run a first campaign.",
    features: ["Partner API key (`ak_live_*`)", "Quest + event pipeline", "Basic analytics"],
  },
  {
    tier: "Growth",
    limit: "300 req / min",
    description: "Production campaigns with real user volume.",
    features: ["Everything in Starter", "Webhook push support", "Bulk reward distribution", "Campaign analytics"],
    popular: true,
  },
  {
    tier: "Enterprise",
    limit: "1,000 req / min",
    description: "High-throughput fintech integrations and platform embeds.",
    features: ["Everything in Growth", "Custom rate limit negotiation", "Dedicated support", "SLA available"],
  },
];

const authExample = `POST /api/v1/quests/:questId/verify
Authorization: Bearer ak_live_xxxxxxxxxxxxxxxxxxxx
Content-Type: application/json

{
  "walletAddress": "0xabc…",
  "idempotencyKey": "evt_2024_abc123",
  "metadata": { "txHash": "0xdef…" }
}`;

const webhookExample = `POST /webhooks/partners/:partnerSlug
X-Akiba-Partner-Key:     <api-key-uuid>
X-Akiba-Signature:       <HMAC-SHA256 hex>
X-Akiba-Timestamp:       1719600000
X-Akiba-Idempotency-Key: evt_unique_id_abc

// HMAC formula:
// HMAC-SHA256(webhookSecret, "\${timestamp}.\${rawBody}")`;

export default function DevelopersPage() {
  return (
    <main>
      {/* Hero */}
      <section className="overflow-hidden bg-akiba-ink px-4 py-16 text-white sm:px-6 lg:px-8 lg:py-20">
        <div className="mx-auto max-w-4xl text-center">
          <div className="inline-flex rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-[#74D4DF]">
            Akiba Platform API · REST · v1
          </div>
          <h1 className="mt-6 font-sterling text-5xl font-medium leading-[1.02] sm:text-6xl">
            Loyalty-as-a-service,<br />via API.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/65">
            Embed the full AkibaMiles loyalty stack into your app or fintech product — quests, events, rewards, campaigns, vouchers, and webhook push — through a single REST API.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ButtonLink href="/developers#contact" className="bg-akiba-teal text-white hover:bg-akiba-teal/90">
              Get API access
            </ButtonLink>
            <Link
              href="/developers#capabilities"
              className="inline-flex items-center gap-2 text-sm font-semibold text-white/70 hover:text-white"
            >
              Explore the API <ArrowUpRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Auth model */}
      <section className="border-b border-akiba-line bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            <div>
              <SectionHeader
                eyebrow="Authentication"
                title="API keys and HMAC webhooks."
                body="Every partner gets a scoped API key (ak_live_*). Inbound webhooks from your backend are HMAC-SHA256 signed, timestamp-validated, and idempotency-keyed — replay-safe by design."
              />
              <ul className="mt-8 space-y-4">
                {[
                  { label: "Partner API key", detail: "ak_live_* · SHA-256 hashed at rest · scoped to a single partner" },
                  { label: "Webhook security", detail: "HMAC-SHA256(secret, timestamp.body) · ±300 s clock window · timing-safe comparison" },
                  { label: "Idempotency", detail: "X-Akiba-Idempotency-Key required on webhooks · unique constraint on (questId, key)" },
                  { label: "Rate limiting", detail: "Per-key tier enforcement · 429 with RATE_LIMIT_EXCEEDED on violation" },
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
              <div className="overflow-hidden rounded-lg bg-akiba-ink">
                <div className="border-b border-white/10 px-4 py-2.5">
                  <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">Quest verify · REST call</span>
                </div>
                <pre className="overflow-x-auto px-5 py-4 text-xs leading-6 text-[#74D4DF]">
                  <code>{authExample}</code>
                </pre>
              </div>
              <div className="overflow-hidden rounded-lg bg-akiba-ink">
                <div className="border-b border-white/10 px-4 py-2.5">
                  <span className="text-xs font-semibold text-white/40 uppercase tracking-widest">Inbound webhook · signed headers</span>
                </div>
                <pre className="overflow-x-auto px-5 py-4 text-xs leading-6 text-[#74D4DF]">
                  <code>{webhookExample}</code>
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* API capabilities */}
      <section id="capabilities" className="scroll-mt-20 bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="API surface"
            title="The full loyalty stack, programmable."
            body="Six capability groups. One auth model. Every endpoint returns structured JSON with consistent error codes."
            align="center"
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {apiCapabilities.map((cap) => {
              const Icon = cap.icon;
              return (
                <article key={cap.title} className="flex flex-col rounded-lg border border-akiba-line bg-white p-6">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-akiba-tint">
                      <Icon className="h-4 w-4 text-akiba-teal" />
                    </div>
                    <h3 className="font-sterling text-lg font-medium text-akiba-ink">{cap.title}</h3>
                  </div>
                  <p className="mt-3 flex-1 text-sm leading-7 text-akiba-muted">{cap.body}</p>
                  <div className="mt-4 space-y-1">
                    {cap.endpoints.map((ep) => (
                      <code key={ep} className="block rounded bg-akiba-paper px-2.5 py-1 text-xs text-akiba-teal">
                        {ep}
                      </code>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Rate tiers */}
      <section id="pricing" className="scroll-mt-20 bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Rate limits"
            title="Three tiers. Start free."
            body="Rate limits apply per API key. Violations return HTTP 429 with error code RATE_LIMIT_EXCEEDED. Talk to us if you need a custom limit."
            align="center"
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {rateTiers.map((tier) => (
              <article
                key={tier.tier}
                className={`flex flex-col rounded-lg p-6 ${
                  tier.popular
                    ? "bg-akiba-ink text-white ring-2 ring-akiba-teal"
                    : "border border-akiba-line bg-white"
                }`}
              >
                <div>
                  <span className={`text-xs font-semibold uppercase tracking-widest ${tier.popular ? "text-[#74D4DF]" : "text-akiba-teal"}`}>
                    {tier.tier}
                  </span>
                  <p className={`mt-3 font-sterling text-3xl font-semibold ${tier.popular ? "text-white" : "text-akiba-ink"}`}>
                    {tier.limit}
                  </p>
                  <p className={`mt-2 text-sm ${tier.popular ? "text-white/60" : "text-akiba-muted"}`}>
                    {tier.description}
                  </p>
                </div>
                <ul className="mt-6 flex-1 space-y-3">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-sm">
                      <Check className={`mt-0.5 h-4 w-4 shrink-0 ${tier.popular ? "text-[#74D4DF]" : "text-akiba-teal"}`} />
                      <span className={tier.popular ? "text-white/80" : "text-akiba-muted"}>{f}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Use cases band */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Who uses the API"
            title="Built for fintech builders, not just marketers."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {[
              {
                title: "Mobile money apps",
                body: "Trigger mile issuance on qualifying M-Pesa or mobile-money transactions via event push or webhook. No SDK required — a single POST fires the reward pipeline.",
              },
              {
                title: "Merchant POS / checkout",
                body: "Post a purchase event at checkout and have miles land in your customer's wallet before the receipt prints. Works with any stack — REST, not proprietary SDK.",
              },
              {
                title: "Fintech & neobank embeds",
                body: "White-label the full loyalty loop inside your own product. Quest completion, rewards, campaign eligibility — all callable from your backend, with your branding in the consumer-facing layer.",
              },
            ].map((item) => (
              <article key={item.title} className="rounded-lg border border-akiba-line bg-white p-6">
                <h3 className="font-sterling text-xl font-medium text-akiba-ink">{item.title}</h3>
                <p className="mt-3 text-sm leading-7 text-akiba-muted">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* CTA / contact */}
      <section id="contact" className="scroll-mt-20 bg-akiba-ink px-4 py-16 text-white sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <p className="font-sterling text-base font-medium text-[#74D4DF]">Get access</p>
          <h2 className="mt-3 font-sterling text-4xl font-medium leading-[1.08]">
            Ready to integrate?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg leading-8 text-white/65">
            Tell us what you&apos;re building and we&apos;ll provision a partner key, walk you through the relevant endpoints, and get your first quest or event pipeline live within a day.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <ButtonLink
              href={`mailto:${siteConfig.email}?subject=API%20Access%20Request`}
              className="bg-akiba-teal text-white hover:bg-akiba-teal/90"
            >
              Email us for API access
            </ButtonLink>
            <ButtonLink href="/merchants#contact" variant="secondary" className="border-white/20 text-white hover:bg-white/10">
              Merchant dashboard access
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm text-white/40">
            We respond within 2 business days with your key and onboarding notes.
          </p>
        </div>
      </section>
    </main>
  );
}
