"use client";

import Image, { type ImageLoaderProps } from "next/image";
import Link from "next/link";
import { ArrowRight, BadgeCheck } from "lucide-react";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import type { VerifiedDiscoveryHighlight } from "@/lib/home/types";

function passthroughLoader({ src }: ImageLoaderProps): string {
  return src;
}

function recommendationReason(highlight: VerifiedDiscoveryHighlight): string {
  if (highlight.recommendedItems.length > 0) {
    return `Visitors recommend ${highlight.recommendedItems.join(" and ")}.`;
  }
  if (highlight.lovedLabels.length > 0) {
    return `Loved for ${highlight.lovedLabels.join(" and ")}.`;
  }
  if (highlight.verifiedRecommendationBand.kind === "exact") {
    return `Recommended across ${highlight.verifiedRecommendationBand.count} verified visits.`;
  }
  return "Recently recommended by a verified Akiba visitor.";
}

export function VerifiedPlacesSection({ highlights }: { highlights: VerifiedDiscoveryHighlight[] }) {
  const visible = highlights.slice(0, 2);
  if (visible.length === 0) return null;

  return (
    <section className="mb-7" aria-labelledby="verified-places-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id="verified-places-heading" className="font-sterling text-xl font-semibold text-akiba-ink sm:text-2xl">
            Places worth a visit
          </h2>
          <p className="mt-0.5 text-xs text-akiba-muted sm:text-sm">Real photos and recommendations from verified visits.</p>
        </div>
        <Link
          href="/merchants"
          className="-mb-1 -mr-2 flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-tint hover:text-akiba-tealDark active:bg-akiba-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
        >
          Explore <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {visible.map((highlight, index) => (
          <TrackedLink
            key={highlight.merchantId}
            href={`/merchants/${highlight.merchantSlug}#photos`}
            event="profile_verified_place_tap"
            eventProps={{ merchant_id: highlight.merchantId, position: index }}
            className="group flex min-h-28 overflow-hidden rounded-2xl border border-akiba-line bg-white transition hover:border-akiba-teal/40 hover:shadow-chip active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal motion-reduce:transform-none"
          >
            <div className="relative w-28 shrink-0 overflow-hidden bg-akiba-card sm:w-32">
              <Image
                loader={passthroughLoader}
                unoptimized
                fill
                sizes="128px"
                src={highlight.photo.thumbnailUrl}
                alt={highlight.photo.altText}
                className="object-cover transition-transform duration-300 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
              />
              <span className="absolute left-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/95 text-akiba-teal shadow-sm backdrop-blur-sm" aria-label="From verified visits">
                <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              </span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center p-3.5 sm:p-4">
              <h3 className="truncate text-xs font-semibold uppercase tracking-wide text-akiba-muted group-hover:text-akiba-teal">
                {highlight.merchantName}
              </h3>
              <p className="mt-1.5 font-sterling text-base font-semibold leading-snug text-akiba-ink sm:text-lg">
                {recommendationReason(highlight)}
              </p>
              <span className="mt-2 text-[11px] font-medium text-akiba-teal">Verified visitor feedback</span>
            </div>
          </TrackedLink>
        ))}
      </div>
    </section>
  );
}
