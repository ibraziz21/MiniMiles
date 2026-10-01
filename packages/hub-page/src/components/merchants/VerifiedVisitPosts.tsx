"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { BadgeCheck, ChevronLeft, ChevronRight, Images, Sparkles, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { PublicCustomerPhoto, PublicVerifiedVisit } from "@/lib/merchants/types";
import { track } from "@/lib/analytics/track";

type VisitPost = PublicVerifiedVisit & { isRecommendation: boolean };

function passthroughLoader({ src }: ImageLoaderProps): string {
  return src;
}

export function VerifiedVisitPosts({
  merchantId,
  merchantName,
  visits,
  customerPhotos,
}: {
  merchantId: string;
  merchantName: string;
  visits: PublicVerifiedVisit[];
  customerPhotos: PublicCustomerPhoto[];
}) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const attachedPhotoIds = new Set(visits.flatMap((visit) => visit.photos.map((photo) => photo.id)));
  const standalonePosts: VisitPost[] = customerPhotos
    .filter((photo) => !attachedPhotoIds.has(photo.id))
    .map((photo) => ({
      id: `photo-${photo.id}`,
      experienceLabels: [],
      photos: [photo],
      isRecommendation: false,
    }));
  const posts: VisitPost[] = [
    ...visits.map((visit) => ({ ...visit, isRecommendation: true })),
    ...standalonePosts,
  ];
  const [selectedPostIndex, setSelectedPostIndex] = useState<number | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState(0);
  const selectedPost = selectedPostIndex == null ? null : posts[selectedPostIndex] ?? null;
  const selectedPhoto = selectedPost?.photos[selectedPhotoIndex] ?? null;
  const selectedPhotoCount = selectedPost?.photos.length ?? 0;

  function closePost() {
    setSelectedPostIndex(null);
    setSelectedPhotoIndex(0);
    requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }

  function openPost(index: number, trigger: HTMLButtonElement) {
    lastTriggerRef.current = trigger;
    setSelectedPostIndex(index);
    setSelectedPhotoIndex(0);
    track("merchant_verified_visit_open", { merchantId, has_photo: posts[index]?.photos.length > 0 });
  }

  function movePhoto(direction: -1 | 1) {
    if (!selectedPost || selectedPost.photos.length < 2) return;
    setSelectedPhotoIndex((current) => (current + direction + selectedPost.photos.length) % selectedPost.photos.length);
  }

  useEffect(() => {
    if (selectedPostIndex == null) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedPostIndex(null);
        setSelectedPhotoIndex(0);
        requestAnimationFrame(() => lastTriggerRef.current?.focus());
      }
      if (event.key === "ArrowLeft" && selectedPhotoCount > 1) {
        setSelectedPhotoIndex((current) => (current - 1 + selectedPhotoCount) % selectedPhotoCount);
      }
      if (event.key === "ArrowRight" && selectedPhotoCount > 1) {
        setSelectedPhotoIndex((current) => (current + 1) % selectedPhotoCount);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedPhotoCount, selectedPostIndex]);

  if (posts.length === 0) {
    return (
      <div className="border-b border-akiba-line px-5 py-10 text-center sm:border-b-0 sm:py-14">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-akiba-line bg-white text-akiba-teal shadow-sm">
          <BadgeCheck className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />
        </span>
        <p className="mt-4 font-sterling text-lg font-semibold text-akiba-ink">No verified visits yet</p>
        <p className="mx-auto mt-1 max-w-md text-sm leading-5 text-akiba-muted">
          Recommendations and approved photos from verified Akiba visits will appear here.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Verified customer visits" className="px-4 pb-5 pt-2 sm:px-0 sm:pt-4">
      <div className="mb-3 hidden items-end justify-between gap-4 px-0.5 sm:flex">
        <div>
          <h3 className="font-sterling text-lg font-semibold text-akiba-ink">From verified visits</h3>
          <p className="mt-0.5 text-xs leading-5 text-akiba-muted sm:text-sm">
            Anonymous recommendations backed by an eligible Akiba purchase.
          </p>
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-akiba-ink">
          {posts.length} {posts.length === 1 ? "visit" : "visits"}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {posts.map((post, index) => {
          const cover = post.photos[0] ?? null;
          return (
            <button
              key={post.id}
              type="button"
              onClick={(event) => openPost(index, event.currentTarget)}
              aria-label={`Open verified visit ${index + 1}`}
              className="group relative min-h-52 overflow-hidden rounded-[1.35rem] border border-akiba-line bg-white text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-soft active:translate-y-0 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2 motion-reduce:transform-none motion-reduce:transition-none sm:min-h-64"
            >
              {cover ? (
                <Image
                  loader={passthroughLoader}
                  unoptimized
                  fill
                  sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, 33vw"
                  src={cover.thumbnailUrl}
                  alt={cover.altText}
                  className="object-cover transition-transform duration-500 group-hover:scale-[1.025] motion-reduce:transform-none motion-reduce:transition-none"
                />
              ) : (
                <div className="absolute inset-0 bg-akiba-tint">
                  <div className="absolute -right-8 -top-8 h-36 w-36 rounded-full border-[24px] border-white/55" />
                  <Sparkles className="absolute bottom-16 right-5 h-10 w-10 text-akiba-teal/25" strokeWidth={1.2} aria-hidden="true" />
                </div>
              )}

              {cover && <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-black/25" />}
              <span className={`absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md ${
                cover ? "bg-black/45 text-white" : "bg-white/80 text-akiba-teal"
              }`}>
                <BadgeCheck className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                Verified visit
              </span>
              {post.photos.length > 1 && (
                <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/45 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
                  <Images className="h-3.5 w-3.5" aria-hidden="true" />
                  {post.photos.length}
                </span>
              )}
              <div className={`absolute inset-x-0 bottom-0 p-4 ${cover ? "text-white" : "text-akiba-ink"}`}>
                <p className="font-sterling text-lg font-semibold leading-tight">
                  {post.isRecommendation ? `Would recommend ${merchantName}` : `A verified visit to ${merchantName}`}
                </p>
                <p className={`mt-1 text-xs ${cover ? "text-white/75" : "text-akiba-muted"}`}>
                  Tap to see the verified visit
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {selectedPost && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="fixed inset-0 z-[90] flex min-h-dvh items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closePost();
          }}
        >
          <article className="grid max-h-[94dvh] w-full max-w-5xl overflow-hidden rounded-t-[1.75rem] bg-white shadow-2xl sm:max-h-[88dvh] sm:rounded-[1.75rem] lg:grid-cols-[minmax(0,1.45fr)_minmax(300px,0.75fr)]">
            {selectedPhoto ? (
              <div className="relative min-h-[46dvh] bg-black sm:min-h-[55dvh] lg:min-h-[680px]">
                <Image
                  loader={passthroughLoader}
                  unoptimized
                  fill
                  sizes="(max-width: 1023px) 100vw, 68vw"
                  src={selectedPhoto.displayUrl}
                  alt={selectedPhoto.altText}
                  className="object-contain"
                />
                {selectedPost.photos.length > 1 && (
                  <>
                    <button type="button" onClick={() => movePhoto(-1)} aria-label="Previous visit photo" className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <button type="button" onClick={() => movePhoto(1)} aria-label="Next visit photo" className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
                      <ChevronRight className="h-5 w-5" aria-hidden="true" />
                    </button>
                    <span className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold tabular-nums text-white backdrop-blur-sm">
                      {selectedPhotoIndex + 1} / {selectedPost.photos.length}
                    </span>
                  </>
                )}
              </div>
            ) : (
              <div className="hidden min-h-[520px] items-center justify-center bg-akiba-tint lg:flex">
                <BadgeCheck className="h-20 w-20 text-akiba-teal/25" strokeWidth={1} aria-hidden="true" />
              </div>
            )}

            <div className="relative flex min-h-0 flex-col overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-14 sm:px-7 sm:pb-7 lg:pt-20">
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closePost}
                aria-label="Close verified visit"
                className="absolute right-3 top-3 flex h-11 w-11 items-center justify-center rounded-full bg-akiba-card text-akiba-ink transition-colors hover:bg-akiba-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal motion-reduce:transition-none"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
              <div className="flex items-center gap-2 text-akiba-teal">
                <BadgeCheck className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                <span className="text-xs font-semibold uppercase tracking-[0.1em]">Verified Akiba visit</span>
              </div>
              <h3 id={titleId} className="mt-3 font-sterling text-2xl font-semibold leading-tight text-akiba-ink">
                {selectedPost.isRecommendation ? `Would recommend ${merchantName}` : `A verified visit to ${merchantName}`}
              </h3>
              {selectedPost.experienceLabels.length > 0 && (
                <>
                  <p className="mt-6 text-xs font-semibold uppercase tracking-[0.1em] text-akiba-muted">What stood out</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {selectedPost.experienceLabels.map((label) => (
                      <li key={label} className="rounded-full bg-akiba-tint px-3 py-1.5 text-sm font-medium text-akiba-ink">
                        {label}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="mt-auto border-t border-akiba-line pt-5 text-xs leading-5 text-akiba-muted">
                Shared anonymously after an eligible Akiba purchase. Verification confirms the visit, not every detail shown in a photo.
              </div>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
