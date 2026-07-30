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
export function MerchantRail({ section, seeAllHref }: { section: HomeFeedSection; seeAllHref?: string }) {
  if (section.merchants.length === 0) return null;

  return (
    <section className="mb-5" aria-label={section.title}>
      <SectionViewTracker sectionId={section.id} personalized={section.personalized} />
      <div className="mb-2.5 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-akiba-muted">{section.title}</h2>
        {seeAllHref && (
          <Link href={seeAllHref} className="flex items-center gap-1 text-xs font-semibold text-akiba-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal">
            See all <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
        {section.merchants.map((m, i) => (
          <div key={m.id} className="w-64 shrink-0">
            <MerchantValueCard merchant={m} sectionId={section.id} position={i} />
          </div>
        ))}
      </div>
    </section>
  );
}
