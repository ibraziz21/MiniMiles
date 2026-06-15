import { ArrowUpRight } from "lucide-react";
import { SectionHeader } from "@/components/SectionHeader";
import { categories } from "@/data/categories";

export function CategoryGrid() {
  return (
    <section id="categories" className="bg-akiba-paper px-4 py-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionHeader
          eyebrow="Explore by Category"
          title="Every kind of reward in one place"
          body="From wallet campaigns to partner quests, games, and merchant vouchers — Akiba covers the full rewards spectrum."
          align="center"
        />

        <div className="mt-10 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {categories.map((category) => (
            <a
              key={category.id}
              href={category.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex flex-col gap-3 rounded-lg border border-akiba-line bg-white p-5 no-underline shadow-chip transition hover:border-akiba-teal hover:shadow-soft"
            >
              <div className="flex items-center justify-between">
                <span
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-akiba-tint text-xl"
                  aria-hidden="true"
                >
                  {category.icon}
                </span>
                <ArrowUpRight className="h-4 w-4 text-akiba-muted opacity-0 transition-all group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 group-hover:text-akiba-teal" />
              </div>
              <div>
                <h3 className="font-sterling text-base font-semibold text-akiba-ink">
                  {category.label}
                </h3>
                <p className="mt-1 text-sm leading-5 text-akiba-muted">{category.description}</p>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
