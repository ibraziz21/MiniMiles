"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { BadgeCheck, Camera, ChevronLeft, ChevronRight, MapPin, MessageSquarePlus, Store, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { track } from "@/lib/analytics/track";
import { TrackedLink } from "@/components/akiba/TrackedLink";
import { VerifiedVisitPosts } from "@/components/merchants/VerifiedVisitPosts";
import type {
  MemberVerifiedVisitSummary,
  PublicCustomerPhoto,
  PublicMerchantMedia,
  PublicVerifiedVisit,
} from "@/lib/merchants/types";

type ProfileTab = "verified" | "merchant" | "locations";
type GalleryPhoto = {
  id: string;
  thumbnailUrl: string;
  displayUrl: string;
  altText: string;
  label: string | null;
};

const INITIAL_PHOTO_COUNT = 6;

function passthroughLoader({ src }: ImageLoaderProps): string {
  return src;
}

function toMerchantGalleryPhoto(photo: PublicMerchantMedia): GalleryPhoto {
  return {
    id: photo.id,
    thumbnailUrl: photo.thumbnailUrl,
    displayUrl: photo.imageUrl,
    altText: photo.altText,
    label: photo.title,
  };
}

function memberVisitCopy(visit: MemberVerifiedVisitSummary, merchantName: string): string {
  if (visit.recommendation === "recommended") return `You’d recommend ${merchantName}.`;
  if (visit.recommendation === "not_recommended") return "Your private feedback was saved.";
  return "Your verified visit details were saved.";
}

function memberPhotoCopy(photoState: MemberVerifiedVisitSummary["photoState"]): string {
  if (photoState === "under_review") return "Your photo is being processed and reviewed.";
  if (photoState === "approved") return "Your photo is approved and now appears in Verified visits.";
  if (photoState === "not_approved") return "Your report is saved, but its photo is not eligible for the gallery.";
  return "No photo was added to this visit.";
}

export function MerchantPhotoTabs({
  merchantName,
  merchantId,
  verifiedVisits,
  customerPhotos,
  merchantMedia,
  memberVerifiedVisit,
  contributionHref,
  locationCount,
  locationsContent,
}: {
  merchantName: string;
  merchantId: string;
  verifiedVisits: PublicVerifiedVisit[];
  customerPhotos: PublicCustomerPhoto[];
  merchantMedia: PublicMerchantMedia[];
  memberVerifiedVisit: MemberVerifiedVisitSummary | null;
  contributionHref: string | null;
  locationCount: number;
  locationsContent?: ReactNode;
}) {
  const tabsId = useId();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const lastTriggerRef = useRef<HTMLButtonElement | null>(null);
  const availableTabs: ProfileTab[] = locationCount > 0
    ? ["verified", "merchant", "locations"]
    : ["verified", "merchant"];
  const [activeTab, setActiveTab] = useState<ProfileTab>(() => {
    if (memberVerifiedVisit) return "verified";
    if (verifiedVisits.length > 0) return "verified";
    if (customerPhotos.length > 0) return "verified";
    if (merchantMedia.length > 0) return "merchant";
    return locationCount > 0 ? "locations" : "verified";
  });
  const [showAll, setShowAll] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const photos = activeTab === "merchant" ? merchantMedia.map(toMerchantGalleryPhoto) : [];
  const visiblePhotos = showAll ? photos : photos.slice(0, INITIAL_PHOTO_COUNT);
  const viewerPhoto = viewerIndex == null ? null : photos[viewerIndex] ?? null;
  const hasAnyContent =
    memberVerifiedVisit !== null || verifiedVisits.length > 0 || customerPhotos.length > 0 || merchantMedia.length > 0 || locationCount > 0;

  useEffect(() => {
    if (!hasAnyContent) return;
    if (activeTab === "locations") {
      track("merchant_locations_tab_view", { merchantId, locationCount });
      return;
    }
    track("merchant_photo_source_view", { merchantId, source: activeTab });
  }, [activeTab, hasAnyContent, locationCount, merchantId]);

  function selectTab(tab: ProfileTab) {
    setActiveTab(tab);
    setShowAll(false);
    setViewerIndex(null);
  }

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % availableTabs.length;
    if (event.key === "ArrowLeft") nextIndex = (index - 1 + availableTabs.length) % availableTabs.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = availableTabs.length - 1;
    if (nextIndex == null) return;

    event.preventDefault();
    const nextTab = availableTabs[nextIndex];
    if (!nextTab) return;
    selectTab(nextTab);
    tabRefs.current[nextIndex]?.focus();
  }

  function closeViewer() {
    setViewerIndex(null);
    requestAnimationFrame(() => lastTriggerRef.current?.focus());
  }

  function moveViewer(direction: -1 | 1) {
    setViewerIndex((current) => {
      if (current == null || photos.length < 2) return current;
      return (current + direction + photos.length) % photos.length;
    });
  }

  useEffect(() => {
    if (viewerIndex == null) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Tab") {
        const focusable = Array.from(
          viewerRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? [],
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (first && last && event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (first && last && !event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
      if (event.key === "Escape") {
        setViewerIndex(null);
        requestAnimationFrame(() => lastTriggerRef.current?.focus());
      }
      if (event.key === "ArrowLeft") {
        setViewerIndex((current) => current == null || photos.length < 2
          ? current
          : (current - 1 + photos.length) % photos.length);
      }
      if (event.key === "ArrowRight") {
        setViewerIndex((current) => current == null || photos.length < 2
          ? current
          : (current + 1) % photos.length);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [viewerIndex, photos.length]);

  if (!hasAnyContent) return null;

  const verifiedTabId = `${tabsId}-verified-tab`;
  const verifiedPanelId = `${tabsId}-verified-panel`;
  const merchantTabId = `${tabsId}-merchant-tab`;
  const merchantPanelId = `${tabsId}-merchant-panel`;
  const locationsTabId = `${tabsId}-locations-tab`;
  const locationsPanelId = `${tabsId}-locations-panel`;
  const activePanelId = activeTab === "verified"
    ? verifiedPanelId
    : activeTab === "merchant"
      ? merchantPanelId
      : locationsPanelId;
  const activeTabId = activeTab === "verified"
    ? verifiedTabId
    : activeTab === "merchant"
      ? merchantTabId
      : locationsTabId;

  return (
    <section
      id="photos"
      className="-mx-4 order-1 scroll-mt-32 lg:col-span-2 sm:mx-0"
      aria-labelledby={`${tabsId}-heading`}
    >
      <h2 id={`${tabsId}-heading`} className="sr-only">Merchant profile content</h2>

      <div
        role="tablist"
        aria-label={`${merchantName} profile content`}
        className={`sticky top-16 z-20 grid border-y border-akiba-line bg-akiba-paper/95 backdrop-blur-md supports-[backdrop-filter]:bg-akiba-paper/85 ${
          locationCount > 0 ? "grid-cols-3" : "grid-cols-2"
        }`}
      >
        <button
          ref={(node) => { tabRefs.current[0] = node; }}
          id={verifiedTabId}
          type="button"
          role="tab"
          aria-label="Verified visits"
          aria-selected={activeTab === "verified"}
          aria-controls={verifiedPanelId}
          tabIndex={activeTab === "verified" ? 0 : -1}
          onClick={() => selectTab("verified")}
          onKeyDown={(event) => onTabKeyDown(event, 0)}
          className={`relative flex min-h-14 min-w-0 cursor-pointer touch-manipulation flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-semibold leading-tight transition-colors after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:content-[''] active:bg-akiba-card focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-akiba-teal motion-reduce:transition-none sm:min-h-14 sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-sm md:min-h-14 ${
            activeTab === "verified"
              ? "text-akiba-ink after:bg-akiba-teal"
              : "text-akiba-muted after:bg-transparent hover:text-akiba-ink"
          }`}
        >
          <Camera className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
          <span className="sm:hidden">Verified</span>
          <span className="hidden sm:inline">Verified visits</span>
        </button>
        <button
          ref={(node) => { tabRefs.current[1] = node; }}
          id={merchantTabId}
          type="button"
          role="tab"
          aria-label="From the business"
          aria-selected={activeTab === "merchant"}
          aria-controls={merchantPanelId}
          tabIndex={activeTab === "merchant" ? 0 : -1}
          onClick={() => selectTab("merchant")}
          onKeyDown={(event) => onTabKeyDown(event, 1)}
          className={`relative flex min-h-14 min-w-0 cursor-pointer touch-manipulation flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-semibold leading-tight transition-colors after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:content-[''] active:bg-akiba-card focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-akiba-teal motion-reduce:transition-none sm:min-h-14 sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-sm md:min-h-14 ${
            activeTab === "merchant"
              ? "text-akiba-ink after:bg-akiba-teal"
              : "text-akiba-muted after:bg-transparent hover:text-akiba-ink"
          }`}
        >
          <Store className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
          <span className="sm:hidden">Business</span>
          <span className="hidden sm:inline">From the business</span>
        </button>
        {locationCount > 0 && (
          <button
            ref={(node) => { tabRefs.current[2] = node; }}
            id={locationsTabId}
            type="button"
            role="tab"
            aria-label="Locations"
            aria-selected={activeTab === "locations"}
            aria-controls={locationsPanelId}
            tabIndex={activeTab === "locations" ? 0 : -1}
            onClick={() => selectTab("locations")}
            onKeyDown={(event) => onTabKeyDown(event, 2)}
            className={`relative flex min-h-14 min-w-0 cursor-pointer touch-manipulation flex-col items-center justify-center gap-1 px-1 py-1.5 text-[11px] font-semibold leading-tight transition-colors after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:content-[''] active:bg-akiba-card focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-akiba-teal motion-reduce:transition-none sm:min-h-14 sm:flex-row sm:gap-2 sm:px-3 sm:py-2 sm:text-sm md:min-h-14 ${
              activeTab === "locations"
                ? "text-akiba-ink after:bg-akiba-teal"
                : "text-akiba-muted after:bg-transparent hover:text-akiba-ink"
            }`}
          >
            <MapPin className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            Locations
          </button>
        )}
      </div>

      {activeTab !== "verified" && (
        <div id={verifiedPanelId} role="tabpanel" aria-labelledby={verifiedTabId} hidden />
      )}
      {activeTab !== "merchant" && (
        <div id={merchantPanelId} role="tabpanel" aria-labelledby={merchantTabId} hidden />
      )}
      {locationCount > 0 && activeTab !== "locations" && (
        <div id={locationsPanelId} role="tabpanel" aria-labelledby={locationsTabId} hidden>
          {locationsContent}
        </div>
      )}
      <div
        id={activePanelId}
        role="tabpanel"
        aria-labelledby={activeTabId}
        tabIndex={0}
        className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-akiba-teal"
      >
        {activeTab === "locations" ? (
          <div className="px-4 py-4 sm:px-0 sm:py-5">
            <div className="mb-4 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-6">
              <div className="min-w-0">
                <h3 className="font-sterling text-lg font-semibold text-akiba-ink">
                  {locationCount === 1 ? "Visit us" : "Branches"}
                </h3>
                <p className="mt-0.5 text-sm leading-5 text-akiba-muted">
                  Opening hours, contact details and directions.
                </p>
              </div>
              <p className="shrink-0 text-xs font-semibold tabular-nums text-akiba-ink sm:pb-0.5 sm:text-sm">
                {locationCount} {locationCount === 1 ? "location" : "locations"}
              </p>
            </div>
            {locationsContent}
          </div>
        ) : (
          <>
            {activeTab === "verified" && (
              <>
                {contributionHref && (
                  <div className="mx-4 mt-4 flex min-w-0 flex-col gap-3 rounded-2xl border border-akiba-teal/20 bg-akiba-tint px-4 py-3.5 sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:gap-5 sm:px-5">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-akiba-teal shadow-sm">
                        <MessageSquarePlus className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-akiba-ink">Your Akiba visit is verified</h3>
                        <p className="mt-0.5 max-w-2xl text-[13px] leading-5 text-akiba-muted sm:text-sm">
                          Add what you tried, what you would recommend and optional photos.
                        </p>
                      </div>
                    </div>
                    <TrackedLink
                      href={contributionHref}
                      event="merchant_verified_visit_cta_tap"
                      eventProps={{ merchant_id: merchantId }}
                      className="flex min-h-11 w-full shrink-0 touch-manipulation items-center justify-center rounded-full bg-akiba-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-akiba-teal active:bg-akiba-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2 motion-reduce:transition-none sm:w-auto"
                    >
                      Add your visit
                    </TrackedLink>
                  </div>
                )}

                {memberVerifiedVisit && (
                  <div className="mx-4 mt-3 flex min-w-0 items-start gap-3 rounded-2xl border border-akiba-line bg-white px-4 py-4 shadow-sm sm:mx-0 sm:px-5">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-akiba-tint text-akiba-teal">
                      <BadgeCheck className="h-5 w-5" strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h3 className="text-sm font-semibold text-akiba-ink">Your verified visit</h3>
                        <span className="rounded-full bg-akiba-card px-2 py-0.5 text-[11px] font-semibold text-akiba-muted">
                          Only visible to you
                        </span>
                      </div>
                      <p className="mt-1 text-[13px] leading-5 text-akiba-ink sm:text-sm">
                        {memberVisitCopy(memberVerifiedVisit, merchantName)}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-akiba-muted">
                        {memberPhotoCopy(memberVerifiedVisit.photoState)}
                      </p>
                    </div>
                  </div>
                )}

                <VerifiedVisitPosts
                  merchantId={merchantId}
                  merchantName={merchantName}
                  visits={verifiedVisits}
                  customerPhotos={customerPhotos}
                />
              </>
            )}

            {activeTab === "merchant" && (
              <>
                <div className="flex min-w-0 flex-col gap-1 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:px-0 md:py-4">
                  <p className="min-w-0 max-w-3xl text-[13px] leading-5 text-akiba-muted sm:text-sm sm:leading-6">
                    Provided by {merchantName}. Product and business photos are not customer verification.
                  </p>
                  <p className="shrink-0 text-xs font-semibold tabular-nums text-akiba-ink sm:pt-0.5 sm:text-sm">
                    {photos.length} {photos.length === 1 ? "photo" : "photos"}
                  </p>
                </div>

                {photos.length === 0 ? (
              <div className="border-b border-akiba-line px-5 py-12 text-center sm:border-b-0 sm:py-16 lg:py-20">
                <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-2 border-akiba-ink text-akiba-ink sm:h-16 sm:w-16">
                  <Store className="h-7 w-7" strokeWidth={1.6} aria-hidden="true" />
                </span>
                <p className="mt-4 text-balance font-sterling text-lg font-semibold text-akiba-ink sm:text-xl">
                  No business photos yet
                </p>
                <p className="mx-auto mt-1 max-w-md text-sm leading-5 text-akiba-muted sm:leading-6">
                  {merchantName} has not added photos to this gallery yet.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-px bg-akiba-paper sm:grid-cols-4 sm:gap-1.5 lg:grid-cols-5 lg:gap-2">
                  {visiblePhotos.map((photo, index) => (
                    <button
                      key={photo.id}
                      type="button"
                      onClick={(event) => {
                        lastTriggerRef.current = event.currentTarget;
                        track("merchant_photo_open", { merchantId, source: activeTab });
                        setViewerIndex(index);
                      }}
                      aria-label={`Open ${photo.altText}`}
                      className="group relative aspect-square min-h-11 cursor-pointer touch-manipulation overflow-hidden bg-akiba-card text-left transition-opacity active:opacity-80 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-akiba-teal motion-reduce:transition-none sm:rounded-lg lg:rounded-xl"
                    >
                      <Image
                        loader={passthroughLoader}
                        unoptimized
                        fill
                        sizes="(max-width: 639px) 33vw, (max-width: 1023px) 25vw, 20vw"
                        src={photo.thumbnailUrl}
                        alt={photo.altText}
                        className="object-cover transition-opacity duration-150 group-hover:opacity-90 motion-reduce:transition-none"
                      />
                    </button>
                  ))}
                </div>
                {photos.length > INITIAL_PHOTO_COUNT && (
                  <div className="flex justify-center border-b border-akiba-line px-4 py-3 sm:border-b-0 sm:px-0 sm:py-4">
                    <button
                      type="button"
                      onClick={() => setShowAll((current) => !current)}
                      className="min-h-11 cursor-pointer rounded-full px-4 py-2 text-sm font-semibold text-akiba-teal transition-colors hover:bg-akiba-tint active:bg-akiba-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal motion-reduce:transition-none"
                    >
                      {showAll ? "Show fewer" : `See all ${photos.length}`}
                    </button>
                  </div>
                )}
              </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {viewerPhoto && viewerIndex != null && (
        <div
          ref={viewerRef}
          role="dialog"
          aria-modal="true"
          aria-label="Business photo viewer"
          className="fixed inset-0 z-[80] grid h-dvh min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-black text-white"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeViewer();
          }}
        >
          <div className="relative z-20 flex min-h-16 items-center gap-3 border-b border-white/10 pb-2 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-[max(0.5rem,env(safe-area-inset-top))] landscape:min-h-12 landscape:py-1 sm:px-5 sm:py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/30 landscape:h-8 landscape:w-8">
              <Store className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold sm:text-base">{merchantName}</p>
              <p className="text-xs text-white/65">
                From the business
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeViewer}
              aria-label="Close photo viewer"
              className="flex h-12 w-12 shrink-0 cursor-pointer touch-manipulation items-center justify-center rounded-full text-white transition-colors hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none landscape:h-11 landscape:w-11"
            >
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
          </div>

          <figure className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
            <div className="relative flex min-h-0 items-center justify-center overflow-hidden sm:px-16 sm:py-4 lg:px-24">
              <div className="relative h-full w-full max-w-6xl overflow-hidden bg-black sm:rounded-2xl">
                <Image
                  loader={passthroughLoader}
                  unoptimized
                  fill
                  sizes="100vw"
                  src={viewerPhoto.displayUrl}
                  alt={viewerPhoto.altText}
                  className="object-contain"
                />
              </div>

              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => moveViewer(-1)}
                    aria-label="Previous photo"
                    className="absolute left-2 z-10 flex h-11 w-11 cursor-pointer touch-manipulation items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/75 active:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none sm:left-4 lg:left-8"
                  >
                    <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveViewer(1)}
                    aria-label="Next photo"
                    className="absolute right-2 z-10 flex h-11 w-11 cursor-pointer touch-manipulation items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-black/75 active:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white motion-reduce:transition-none sm:right-4 lg:right-8"
                  >
                    <ChevronRight className="h-5 w-5" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
            <figcaption className="border-t border-white/10 px-[max(1rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 text-center text-sm leading-5 text-white landscape:py-2 sm:px-6 sm:pb-4">
              <span className="line-clamp-2 sm:inline">{viewerPhoto.label ?? viewerPhoto.altText}</span>
              <span className="ml-2 whitespace-nowrap tabular-nums text-white/60">
                {viewerIndex + 1} of {photos.length}
              </span>
            </figcaption>
          </figure>
        </div>
      )}
    </section>
  );
}
