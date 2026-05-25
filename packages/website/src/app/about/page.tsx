import type { Metadata } from "next";
import Image from "next/image";
import { ButtonLink } from "@/components/ButtonLink";
import { SectionHeader } from "@/components/SectionHeader";
import { aboutContent, siteConfig } from "@/content/site";

export const metadata: Metadata = {
  title: "About",
  description:
    "AkibaMiles is a loyalty and engagement platform with 300K users. Earn miles, spend on real prizes, and connect merchants and projects to an active, incentivized audience.",
};

export default function AboutPage() {
  return (
    <main>
      {/* Hero */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <SectionHeader
            eyebrow={aboutContent.hero.eyebrow}
            title={aboutContent.hero.title}
            body={aboutContent.hero.body}
            as="h1"
          />
          <div className="overflow-hidden rounded-lg bg-akiba-card p-4">
            <Image
              src="/webflow/hero-app.png"
              width={851}
              height={851}
              priority
              alt="AkibaMiles product mockup"
              className="w-full"
            />
          </div>
        </div>
      </section>

      {/* Principles */}
      <section className="bg-white px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <SectionHeader
            eyebrow="Operating principles"
            title="Simple enough for users. Useful enough for partners."
          />
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {aboutContent.principles.map((principle) => (
              <article key={principle.title} className="rounded-lg bg-akiba-card p-6">
                <h2 className="font-sterling text-2xl font-medium text-akiba-ink">
                  {principle.title}
                </h2>
                <p className="mt-3 leading-7 text-akiba-muted">{principle.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* What's built */}
      <section className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <div className="rounded-lg bg-white p-8 lg:p-12">
            <div className="grid items-start gap-10 lg:grid-cols-[1fr_auto]">
              <div>
                <p className="font-sterling text-base font-medium text-akiba-teal">
                  What we&apos;ve built
                </p>
                <h2 className="mt-3 font-sterling text-4xl font-medium leading-[1.08] text-akiba-ink">
                  {aboutContent.builtBy.title}
                </h2>
                <p className="mt-4 max-w-2xl text-lg leading-8 text-akiba-muted">
                  {aboutContent.builtBy.body}
                </p>
                <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {aboutContent.surfaces.map((surface) => (
                    <div
                      key={surface}
                      className="rounded-lg border border-akiba-line bg-akiba-paper px-4 py-3 text-sm font-medium text-akiba-ink"
                    >
                      {surface}
                    </div>
                  ))}
                </div>
                <p className="mt-8 text-sm font-medium text-akiba-muted">
                  {aboutContent.disclaimer}
                </p>
              </div>
              <ButtonLink href={siteConfig.appUrl} className="shrink-0">
                Open app
              </ButtonLink>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
