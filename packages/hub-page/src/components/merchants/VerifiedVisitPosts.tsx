"use client";

import Image, { type ImageLoaderProps } from "next/image";
import {
  BadgeCheck,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Images,
  Share2,
  Sparkles,
  ThumbsUp,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { PublicVerifiedVisit } from "@/lib/merchants/types";
import { track } from "@/lib/analytics/track";

function passthroughLoader({ src }: ImageLoaderProps): string {
  return src;
}

const SWIPE_THRESHOLD = 54;

export function VerifiedVisitPosts({
  communityFavoriteProduct,
  initialHelpfulVisitIds,
  initialSaved,
  isSignedIn,
  merchantId,
  merchantName,
  merchantSlug,
  visits,
}: {
  communityFavoriteProduct: string | null;
  initialHelpfulVisitIds: string[];
  initialSaved: boolean;
  isSignedIn: boolean;
  merchantId: string;
  merchantName: string;
  merchantSlug: string;
  visits: PublicVerifiedVisit[];
}) {
  const router = useRouter();
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const visitPointerStart = useRef<number | null>(null);
  const photoPointerStart = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [visitIndex, setVisitIndex] = useState(0);
  const [photoIndex, setPhotoIndex] = useState(0);
  const [helpfulIds, setHelpfulIds] = useState(() => new Set(initialHelpfulVisitIds));
  const [helpfulPending, setHelpfulPending] = useState(false);
  const [saved, setSaved] = useState(initialSaved);
  const [savePending, setSavePending] = useState(false);
  const [shareConfirmed, setShareConfirmed] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);

  const currentVisit = visits[visitIndex] ?? null;
  const nextVisit = visitIndex < visits.length - 1 ? visits[visitIndex + 1] : null;
  const currentPhotos = currentVisit?.photos ?? [];
  const currentPhoto = currentPhotos[photoIndex] ?? null;
  const summaryPhoto = visits.flatMap((visit) => visit.photos)[0] ?? null;
  const exactCount = visits.length >= 5;
  const countCopy = exactCount ? `${visits.length} verified visits` : "New from verified visits";
  const progressCopy = exactCount ? `${visitIndex + 1} of ${visits.length}` : "Anonymous verified visit";
  const helpful = currentVisit ? helpfulIds.has(currentVisit.id) : false;

  function moveVisit(direction: -1 | 1) {
    setVisitIndex((current) => Math.max(0, Math.min(visits.length - 1, current + direction)));
    setPhotoIndex(0);
    setShareConfirmed(false);
    setShareFailed(false);
  }

  function movePhoto(direction: -1 | 1) {
    if (currentPhotos.length < 2) return;
    setPhotoIndex((current) => (current + direction + currentPhotos.length) % currentPhotos.length);
  }

  function openCommunity() {
    setOpen(true);
    setVisitIndex(0);
    setPhotoIndex(0);
    track("merchant_verified_visit_open", { merchantId, has_photo: Boolean(summaryPhoto) });
  }

  async function toggleHelpful() {
    if (!currentVisit || helpfulPending) return;
    if (!isSignedIn) {
      router.push("/login");
      return;
    }

    const next = !helpful;
    setHelpfulIds((current) => {
      const updated = new Set(current);
      if (next) updated.add(currentVisit.id);
      else updated.delete(currentVisit.id);
      return updated;
    });
    setHelpfulPending(true);
    try {
      const response = await fetch(
        `/api/v1/merchants/${encodeURIComponent(merchantSlug)}/verified-visits/${encodeURIComponent(currentVisit.id)}/helpful`,
        {
          method: next ? "POST" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: next ? "{}" : undefined,
        },
      );
      if (!response.ok) throw new Error("helpful_failed");
      track("merchant_verified_visit_helpful_toggle", { merchantId, helpful: next });
    } catch {
      setHelpfulIds((current) => {
        const updated = new Set(current);
        if (next) updated.delete(currentVisit.id);
        else updated.add(currentVisit.id);
        return updated;
      });
    } finally {
      setHelpfulPending(false);
    }
  }

  async function toggleSaved() {
    if (savePending) return;
    if (!isSignedIn) {
      router.push("/login");
      return;
    }

    const next = !saved;
    setSaved(next);
    setSavePending(true);
    try {
      const response = await fetch(`/api/merchants/${encodeURIComponent(merchantSlug)}/save`, {
        method: next ? "POST" : "DELETE",
      });
      if (!response.ok) throw new Error("save_failed");
    } catch {
      setSaved(!next);
    } finally {
      setSavePending(false);
    }
  }

  async function shareCommunity() {
    const url = `${window.location.origin}/merchants/${merchantSlug}`;
    setShareConfirmed(false);
    setShareFailed(false);

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${merchantName} on Akiba`,
          text: `See verified visits to ${merchantName}.`,
          url,
        });
        setShareConfirmed(true);
        window.setTimeout(() => setShareConfirmed(false), 2200);
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        // If Web Share exists but is unavailable in this context, continue
        // to the copy fallback instead of making the control look inert.
      }
    }

    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = url;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      try {
        document.body.appendChild(textarea);
        textarea.select();
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      } finally {
        textarea.remove();
      }
    }

    setShareConfirmed(copied);
    setShareFailed(!copied);
    window.setTimeout(() => {
      setShareConfirmed(false);
      setShareFailed(false);
    }, 2600);
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (visits.length === 0) {
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
    <section aria-label="Community verified visits" className="px-4 pb-5 pt-2 sm:px-0 sm:pt-4">
      <button
        type="button"
        onClick={openCommunity}
        className="group grid w-full overflow-hidden rounded-[1.5rem] border border-akiba-line bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2 motion-reduce:transform-none sm:grid-cols-[minmax(240px,0.9fr)_minmax(0,1.1fr)]"
      >
        <div className="relative min-h-56 overflow-hidden bg-akiba-tint sm:min-h-72">
          {summaryPhoto ? (
            <Image
              loader={passthroughLoader}
              unoptimized
              fill
              sizes="(max-width: 639px) 100vw, 42vw"
              src={summaryPhoto.thumbnailUrl}
              alt={summaryPhoto.altText}
              className="object-cover transition-transform duration-500 group-hover:scale-[1.02] motion-reduce:transform-none"
            />
          ) : (
            <Sparkles className="absolute bottom-7 right-7 h-16 w-16 text-akiba-teal/25" strokeWidth={1.2} aria-hidden="true" />
          )}
          <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-akiba-teal shadow-sm backdrop-blur-sm">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" /> Community verified
          </span>
        </div>
        <div className="flex min-w-0 flex-col justify-center p-5 sm:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-akiba-teal">{countCopy}</p>
          <h3 className="mt-2 font-sterling text-2xl font-semibold leading-tight text-akiba-ink">Community at {merchantName}</h3>
          <p className="mt-2 text-sm leading-6 text-akiba-muted">
            Swipe through anonymous recommendations, photos and details shared after eligible Akiba purchases.
          </p>
          {communityFavoriteProduct && (
            <div className="mt-5 rounded-2xl bg-akiba-card px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-akiba-muted">Community favorite</p>
              <p className="mt-1 font-sterling text-lg font-semibold text-akiba-ink">{communityFavoriteProduct}</p>
            </div>
          )}
          <span className="mt-5 inline-flex min-h-11 items-center justify-center gap-2 self-start rounded-full bg-akiba-ink px-5 text-sm font-semibold text-white transition-colors group-hover:bg-akiba-teal">
            Explore the community <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
      </button>

      {open && currentVisit && (
        <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="fixed inset-0 z-[90] flex min-h-dvh items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5">
          <article className="flex max-h-[96dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[1.75rem] bg-akiba-paper shadow-2xl sm:max-h-[92dvh] sm:rounded-[1.75rem]">
            <header className="flex shrink-0 items-center gap-3 border-b border-akiba-line bg-white px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-[0.08em] text-akiba-teal">Community at {merchantName}</p>
                <h3 id={titleId} className="mt-0.5 font-sterling text-lg font-semibold text-akiba-ink">{progressCopy}</h3>
              </div>
              <button ref={closeButtonRef} type="button" onClick={() => setOpen(false)} aria-label="Close community visits" className="flex h-11 w-11 items-center justify-center rounded-full bg-akiba-card text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </header>

            <div className="min-h-0 overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-6">
              <div className="relative mx-auto max-w-2xl pr-5">
                {nextVisit && <div aria-hidden="true" className="absolute inset-y-3 left-5 right-0 rounded-[1.6rem] border border-akiba-line bg-white opacity-65 shadow-sm" />}
                <div
                  className="relative overflow-hidden rounded-[1.6rem] border border-akiba-line bg-white shadow-soft"
                  onPointerDown={(event) => { visitPointerStart.current = event.clientX; }}
                  onPointerUp={(event) => {
                    if (visitPointerStart.current == null) return;
                    const delta = event.clientX - visitPointerStart.current;
                    visitPointerStart.current = null;
                    if (delta <= -SWIPE_THRESHOLD) moveVisit(1);
                    else if (delta >= SWIPE_THRESHOLD) moveVisit(-1);
                  }}
                >
                  <div
                    className="relative aspect-[4/3] overflow-hidden bg-akiba-tint touch-pan-y"
                    onPointerDown={(event) => { event.stopPropagation(); photoPointerStart.current = event.clientX; }}
                    onPointerUp={(event) => {
                      event.stopPropagation();
                      if (photoPointerStart.current == null) return;
                      const delta = event.clientX - photoPointerStart.current;
                      photoPointerStart.current = null;
                      if (delta <= -SWIPE_THRESHOLD) movePhoto(1);
                      else if (delta >= SWIPE_THRESHOLD) movePhoto(-1);
                    }}
                  >
                    {currentPhoto ? (
                      <Image loader={passthroughLoader} unoptimized fill sizes="(max-width: 767px) 100vw, 680px" src={currentPhoto.displayUrl} alt={currentPhoto.altText} className="object-cover" />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center"><BadgeCheck className="h-20 w-20 text-akiba-teal/25" strokeWidth={1} aria-hidden="true" /></div>
                    )}
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-white/95 px-3 py-1.5 text-xs font-semibold text-akiba-teal shadow-sm"><BadgeCheck className="h-4 w-4" aria-hidden="true" /> Verified visit</span>
                    {currentPhotos.length > 1 && (
                      <>
                        <button type="button" onClick={(event) => { event.stopPropagation(); movePhoto(-1); }} aria-label="Previous photo" className="absolute left-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white focus-visible:ring-2 focus-visible:ring-white"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
                        <button type="button" onClick={(event) => { event.stopPropagation(); movePhoto(1); }} aria-label="Next photo" className="absolute right-3 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white focus-visible:ring-2 focus-visible:ring-white"><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
                        <span className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white"><Images className="h-3.5 w-3.5" aria-hidden="true" /> {photoIndex + 1} / {currentPhotos.length}</span>
                      </>
                    )}
                  </div>

                  <div className="p-5 sm:p-6">
                    {currentVisit.favoriteOrder && (
                      <>
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-akiba-muted">Favorite order</p>
                        <p className="mt-1 font-sterling text-2xl font-semibold text-akiba-ink">{currentVisit.favoriteOrder}</p>
                      </>
                    )}
                    {currentVisit.experienceLabels.length > 0 && (
                      <div className={currentVisit.favoriteOrder ? "mt-5" : ""}>
                        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-akiba-muted">What stood out on this visit</p>
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {currentVisit.experienceLabels.map((label) => <li key={label} className="rounded-full border border-akiba-line bg-akiba-paper px-3 py-1.5 text-sm font-medium text-akiba-ink">{label}</li>)}
                        </ul>
                      </div>
                    )}
                    <p className="mt-5 text-xs leading-5 text-akiba-muted">Shared anonymously after an eligible Akiba purchase. Each slide is from a different customer.</p>
                  </div>
                </div>
              </div>

              <div className="mx-auto mt-3 flex max-w-2xl items-center gap-3">
                <button type="button" onClick={() => moveVisit(-1)} disabled={visitIndex === 0} aria-label="Previous verified visit" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-akiba-line bg-white text-akiba-ink disabled:opacity-35"><ChevronLeft className="h-5 w-5" aria-hidden="true" /></button>
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-akiba-line" aria-hidden="true"><div className="h-full rounded-full bg-akiba-teal transition-[width]" style={{ width: `${((visitIndex + 1) / visits.length) * 100}%` }} /></div>
                <button type="button" onClick={() => moveVisit(1)} disabled={visitIndex === visits.length - 1} aria-label="Next verified visit" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-akiba-line bg-white text-akiba-ink disabled:opacity-35"><ChevronRight className="h-5 w-5" aria-hidden="true" /></button>
              </div>

              {helpful && <p role="status" className="mx-auto mt-3 max-w-2xl rounded-2xl bg-akiba-tint px-4 py-3 text-center text-sm font-medium text-akiba-teal">Thanks — this helps surface useful visits.</p>}
              {shareConfirmed && <p role="status" className="mx-auto mt-3 max-w-2xl text-center text-xs font-semibold text-akiba-teal">Merchant link copied or shared.</p>}
              {shareFailed && <p role="alert" className="mx-auto mt-3 max-w-2xl text-center text-xs font-semibold text-red-600">Couldn’t open sharing or copy the link. Please try again.</p>}
              <div className="mx-auto mt-3 grid max-w-2xl grid-cols-3 gap-2 sm:gap-3">
                <button type="button" onClick={toggleHelpful} disabled={helpfulPending} aria-pressed={helpful} className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-2 text-sm font-semibold transition ${helpful ? "border-akiba-teal bg-akiba-tint text-akiba-teal" : "border-akiba-line bg-white text-akiba-ink"}`}><ThumbsUp className={`h-5 w-5 ${helpful ? "fill-current" : ""}`} aria-hidden="true" /> Helpful</button>
                <button type="button" onClick={toggleSaved} disabled={savePending} aria-pressed={saved} className={`flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-2 text-sm font-semibold transition ${saved ? "border-akiba-teal bg-akiba-tint text-akiba-teal" : "border-akiba-line bg-white text-akiba-ink"}`}>{saved ? <BookmarkCheck className="h-5 w-5" aria-hidden="true" /> : <Bookmark className="h-5 w-5" aria-hidden="true" />} Save</button>
                <button type="button" onClick={() => void shareCommunity()} aria-label={`Share ${merchantName}`} className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-akiba-line bg-white px-2 text-sm font-semibold text-akiba-ink transition hover:border-akiba-teal/50 hover:text-akiba-teal active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2 motion-reduce:transform-none"><Share2 className="h-5 w-5" aria-hidden="true" /> {shareConfirmed ? "Shared" : "Share"}</button>
              </div>
            </div>
          </article>
        </div>
      )}
    </section>
  );
}
