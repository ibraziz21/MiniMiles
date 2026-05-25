import type { LegalPage as LegalPageContent } from "@/content/legal";

export function LegalPage({ page }: { page: LegalPageContent }) {
  return (
    <main className="bg-akiba-paper">
      <section className="px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="inline-flex rounded-full bg-white px-4 py-2 text-sm font-medium text-akiba-teal shadow-chip">
            Last update: {page.lastUpdated}
          </div>
          <h1 className="mt-6 font-sterling text-5xl font-medium leading-[1.08] text-akiba-ink">
            {page.title}
          </h1>
          <p className="mt-6 text-lg leading-8 text-akiba-muted">{page.intro}</p>

          <div className="mt-12 space-y-10">
            {page.sections.map((section) => (
              <section key={section.title}>
                <h2 className="font-sterling text-3xl font-medium text-akiba-ink">
                  {section.title}
                </h2>
                <div className="mt-4 space-y-4 text-base leading-7 text-akiba-muted">
                  {section.paragraphs?.map((paragraph) => (
                    <p key={paragraph}>{paragraph}</p>
                  ))}
                  {section.bullets ? (
                    <ul className="list-disc space-y-2 pl-5">
                      {section.bullets.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </section>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
