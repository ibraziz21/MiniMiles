import type { Metadata } from "next";
import Image from "next/image";
import { Gamepad2, Gift, Medal, WalletCards } from "lucide-react";
import { ButtonLink } from "@/components/ButtonLink";
import { SectionHeader } from "@/components/SectionHeader";
import { rewardContent, siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "Rewards",
  description:
    "Earn AkibaMiles through daily MiniPay activity and spend them on raffles, games, stablecoins, and real prizes like phones, laptops, and gaming gear.",
};

const icons = [Gift, Medal, Gamepad2, WalletCards];

export default function RewardsPage() {
  return (
    <main>
      {/* Hero */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[0.88fr_1.12fr]">
          <SectionHeader
            eyebrow={rewardContent.hero.eyebrow}
            title={rewardContent.hero.title}
            body={rewardContent.hero.body}
            as="h1"
          />
          <div className="overflow-hidden rounded-lg bg-akiba-card p-4">
            <Image
              src="/webflow/spend-miles.png"
              width={1212}
              height={902}
              priority
              alt="AkibaMiles rewards and spend mockups"
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* 3-step loop */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-3">
          {rewardContent.steps.map((step, index) => (
            <article key={step.title} className="rounded-lg border border-akiba-line p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-akiba-tint font-sterling text-lg font-semibold text-akiba-teal">
                {index + 1}
              </div>
              <h2 className="mt-6 font-sterling text-2xl font-medium text-akiba-ink">
                {step.title}
              </h2>
              <p className="mt-3 leading-7 text-akiba-muted">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Feature blocks */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Reward mechanics"
            title="A reward loop with multiple ways to participate."
            body="Every surface in AkibaMiles is designed around activity you can repeat: daily earning windows, weekly raffles, partner campaigns, and game sessions."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-2">
            {rewardContent.featureBlocks.map((feature, index) => {
              const Icon = icons[index];
              return (
                <article key={feature.title} className="rounded-lg bg-white p-6">
                  <Icon className="h-7 w-7 text-akiba-teal" />
                  <h2 className="mt-6 font-sterling text-3xl font-medium text-akiba-ink">
                    {feature.title}
                  </h2>
                  <p className="mt-3 leading-7 text-akiba-muted">{feature.body}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* Prize strip */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Prize catalogue"
            title="Real prizes, earned not bought."
            body="AkibaMiles prize pools include digital cash and physical products. Here's a sample of what's been up for grabs."
            align="center"
          />
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            {rewardContent.prizes.map((prize) => (
              <span
                key={prize}
                className="rounded-full border border-akiba-line bg-akiba-paper px-4 py-2 text-sm font-medium text-akiba-ink shadow-chip"
              >
                {prize}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-8 rounded-lg bg-akiba-card p-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <h2 className="font-sterling text-4xl font-medium leading-[1.08] text-akiba-ink">
              Open the app. Start earning today.
            </h2>
            <p className="mt-4 text-lg leading-8 text-akiba-muted">
              The marketing site explains the ecosystem. The app is where you earn, spend, and claim.
            </p>
            <div className="mt-6">
              <ButtonLink href={siteConfig.appUrl}>Start Earning</ButtonLink>
            </div>
          </div>
          <Image
            src="/webflow/earn-miles.png"
            width={600}
            height={1181}
            alt="AkibaMiles earn screen mockup"
            className="mx-auto max-h-[520px] w-auto object-contain"
          />
        </div>
      </section>
    </main>
  );
}
