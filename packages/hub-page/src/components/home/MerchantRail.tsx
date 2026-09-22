import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { MerchantValueCard } from "./MerchantValueCard";
import { SectionViewTracker } from "./SectionViewTracker";
import type { HomeFeedSection } from "@/lib/home/types";

/**
 * A section disappears entirely when empty (spec §6: "must not render empty
 * rails merely to preserve the layout") — callers should simply not render
 * this component for a section with zero merchants.
 */
export function MerchantRail({
  section,
  seeAllHref,
  description,
}: {
  section: HomeFeedSection;
  seeAllHref?: string;
  description?: string;
}) {
  if (section.merchants.length === 0) return null;

  return (
    <section className="mb-8" aria-label={section.title}>
      <SectionViewTracker sectionId={section.id} personalized={section.personalized} />
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-sterling text-xl font-semibold text-akiba-ink sm:text-2xl">{section.title}</h2>
          {description && <p className="mt-0.5 text-xs text-akiba-muted sm:text-sm">{description}</p>}
        </div>
        {seeAllHref && (
          <Link href={seeAllHref} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-akiba-teal transition hover:text-akiba-tealDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal">
            See all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        {section.merchants.map((m, i) => (
          <div key={m.id} className="w-[78vw] max-w-[280px] shrink-0 snap-start sm:w-64">
            <MerchantValueCard merchant={m} sectionId={section.id} position={i} />
          </div>
        ))}
      </div>
    </section>
  );
}
