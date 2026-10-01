"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { ArrowRight, BadgeCheck, Heart, Sparkles } from "lucide-react";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import type { VerifiedDiscoveryHighlight } from "@/lib/home/types";

function passthroughLoader({ src }: ImageLoaderProps): string {
  return src;
}

export function VerifiedDiscoverySpotlight({ highlights }: { highlights: VerifiedDiscoveryHighlight[] }) {
  if (highlights.length === 0) return null;

  return (
    <section className="mb-7 sm:mb-8" aria-labelledby="verified-discovery-heading">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-akiba-teal">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">From the community</span>
          </div>
          <h2 id="verified-discovery-heading" className="mt-1 font-sterling text-xl font-semibold text-akiba-ink sm:text-2xl">
            Places people loved
          </h2>
        </div>
        <TrackedLink
          href="/merchants"
          event="home_verified_discovery_see_all_tap"
          className="-mb-1 -mr-2 flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
        >
          Explore <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </TrackedLink>
      </div>

      <div className="no-scrollbar -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:auto-rows-[170px] sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0">
        {highlights.map((highlight, index) => {
          const isLead = index === 0;
          const single = highlights.length === 1;
          const detail = highlight.recommendedItems.length > 0
            ? `Try ${highlight.recommendedItems.join(" · ")}`
            : null;
          return (
            <TrackedLink
              key={highlight.merchantId}
              href={`/merchants/${highlight.merchantSlug}#photos`}
              event="home_verified_discovery_tap"
              eventProps={{ merchant_id: highlight.merchantId, position: index, verified_visit_count: highlight.verifiedVisitCount }}
              className={`group relative min-h-[19rem] w-[82vw] max-w-[330px] shrink-0 snap-start overflow-hidden rounded-[1.5rem] bg-akiba-ink text-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none sm:min-h-0 sm:w-auto sm:max-w-none ${
                single ? "sm:col-span-2 sm:row-span-2" : isLead && highlights.length >= 3 ? "sm:row-span-2" : ""
              }`}
            >
              <Image
                loader={passthroughLoader}
                unoptimized
                fill
                sizes="(max-width: 639px) 82vw, (max-width: 1023px) 50vw, 560px"
                src={highlight.photo.thumbnailUrl}
                alt={highlight.photo.altText}
                className="object-cover transition-transform duration-500 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/15 to-black/25" />

              <div className="absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3.5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md">
                  <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Verified visits
                </span>
                <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold tabular-nums text-akiba-ink backdrop-blur-md">
                  {highlight.verifiedVisitCount} {highlight.verifiedVisitCount === 1 ? "visit" : "visits"}
                </span>
              </div>

              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                <h3 className={`font-sterling font-semibold leading-tight ${isLead || single ? "text-2xl" : "text-xl"}`}>
                  {highlight.merchantName}
                </h3>
                {detail && <p className="mt-1 line-clamp-1 text-sm font-medium text-white/85">{detail}</p>}
                {highlight.lovedLabels.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {highlight.lovedLabels.slice(0, isLead || single ? 3 : 2).map((label) => (
                      <span key={label} className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-md">
                        <Heart className="h-3 w-3 fill-current" aria-hidden="true" /> {label}
                      </span>
                    ))}
                  </div>
                )}
                <p className="mt-3 text-xs font-semibold text-white/80">See verified photos and details →</p>
              </div>
            </TrackedLink>
          );
        })}
      </div>
    </section>
  );
}
