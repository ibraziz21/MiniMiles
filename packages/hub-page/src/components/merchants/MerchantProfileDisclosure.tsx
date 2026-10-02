"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

type Offering = { id: string; name: string; description: string | null };

export function MerchantProfileDisclosure({
  description,
  offerings,
}: {
  description: string | null;
  offerings: Offering[];
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const hasMore = offerings.length > 0 || (description?.length ?? 0) > 120;

  if (!description && offerings.length === 0) return null;

  return (
    <div className="mt-2.5 max-w-3xl">
      {description && (
        <p
          className={`whitespace-pre-line text-[13px] leading-5 text-akiba-muted sm:text-sm sm:leading-6 ${
            expanded ? "" : "line-clamp-1 sm:line-clamp-2"
          }`}
        >
          {description}
        </p>
      )}

      <div id={detailsId} hidden={!expanded}>
        {offerings.length > 0 && (
          <div className="mt-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-akiba-muted">
              What they offer
            </p>
            <div className="flex flex-wrap gap-1.5">
              {offerings.map((offering) => (
                <span
                  key={offering.id}
                  title={offering.description ?? undefined}
                  className="rounded-full border border-akiba-line bg-white px-2.5 py-1 text-xs font-medium text-akiba-ink"
                >
                  {offering.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {hasMore && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={detailsId}
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 inline-flex min-h-8 touch-manipulation items-center gap-1 rounded-full pr-2 text-xs font-semibold text-akiba-ink transition-colors hover:text-akiba-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2 motion-reduce:transition-none sm:min-h-9 sm:text-sm"
        >
          {expanded ? "See less" : "See more"}
          <ChevronDown
            className={`h-4 w-4 transition-transform duration-200 motion-reduce:transition-none ${
              expanded ? "rotate-180" : ""
            }`}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}
