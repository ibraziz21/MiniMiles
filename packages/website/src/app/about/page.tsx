import type { Metadata } from "next";
import { ButtonLink } from "@/components/ButtonLink";
import { Panel } from "@/components/Panel";
import { PhoneFrame } from "@/components/PhoneFrame";
import { SectionHeader } from "@/components/SectionHeader";
import { aboutContent, siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "Akiba is where shoppers find businesses worth going to and get rewarded for going. Merchant-funded Miles, portable vouchers, scheduled offers with reminders, and recommendations only verified customers can leave.",
};

export default function AboutPage() {
  return (
    <main>
      {/* Hero */}
      <Panel tone="wash" bare>
        <div className="grid items-center gap-10 px-5 py-12 sm:px-10 sm:py-16 lg:grid-cols-[0.95fr_1.05fr] lg:px-14 lg:py-20">
          <SectionHeader
            eyebrow={aboutContent.hero.eyebrow}
            title={aboutContent.hero.title}
            body={aboutContent.hero.body}
            as="h1"
          />
          <div className="flex justify-center gap-5">
            <PhoneFrame
              src="/app/explore.webp"
              alt="The Akiba Explore screen showing business offers and places people loved"
              priority
              className="max-w-[250px]"
            />
            <PhoneFrame
              src="/app/merchant-profile.webp"
              alt="An Akiba merchant profile with a verified visit recommendation"
              className="hidden max-w-[220px] self-end sm:block"
            />
          </div>
        </div>
      </Panel>

      {/* Principles */}
      <Panel tone="white">
        <SectionHeader
          eyebrow="Operating principles"
          title="Simple for shoppers. Useful for businesses."
        />
        <div className="mt-12 grid gap-4 md:grid-cols-2">
          {aboutContent.principles.map((principle, index) => (
            <article
              key={principle.title}
              className="rounded-[1.25rem] border border-akiba-line bg-akiba-paper p-6"
            >
              <p className="font-sterling text-sm font-semibold tabular-nums text-akiba-teal">
                {String(index + 1).padStart(2, "0")}
              </p>
              <h2 className="mt-3 font-sterling text-2xl font-medium text-akiba-ink">
                {principle.title}
              </h2>
              <p className="mt-3 leading-7 text-akiba-muted">{principle.body}</p>
            </article>
          ))}
        </div>
      </Panel>

      {/* What's built */}
      <Panel tone="card">
        <div className="grid items-start gap-10 lg:grid-cols-[1fr_auto]">
          <div>
            <SectionHeader eyebrow="What we've built" title={aboutContent.builtBy.title} />
            <p className="mt-5 max-w-2xl text-lg leading-8 text-akiba-muted">
              {aboutContent.builtBy.body}
            </p>
            <div className="mt-8 flex flex-wrap gap-2.5">
              {aboutContent.surfaces.map((surface) => (
                <span
                  key={surface}
                  className="rounded-full border border-akiba-line bg-white px-4 py-2 text-sm font-medium text-akiba-ink"
                >
                  {surface}
                </span>
              ))}
            </div>
            <p className="mt-8 text-sm font-medium text-akiba-muted">{aboutContent.disclaimer}</p>
          </div>
          <ButtonLink href={siteConfig.passUrl} className="shrink-0">
            Open Akiba
          </ButtonLink>
        </div>
      </Panel>
    </main>
  );
}
