"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { Bell, BellOff, Check, ChevronDown, Loader2, SlidersHorizontal } from "lucide-react";
import { useState, type ReactNode } from "react";
import { getMerchantOfferAvailability } from "@/lib/merchants/offerAvailability";
import type { PublicMerchantOffer } from "@/lib/merchants/types";

type OfferFilter = "all" | "business" | "akiba";
type ReminderLead = 30 | 60 | 1440;

const REMINDER_OPTIONS: Array<{ value: ReminderLead; label: string }> = [
  { value: 30, label: "30 minutes before" },
  { value: 60, label: "1 hour before" },
  { value: 1440, label: "1 day before" },
];

function passthroughLoader({ src }: ImageLoaderProps): string {
  return src;
}

function OfferReminder({
  initialSet,
  isSignedIn,
  offerId,
  signInHref,
}: {
  initialSet: boolean;
  isSignedIn: boolean;
  offerId: string;
  signInHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [leadMinutes, setLeadMinutes] = useState<ReminderLead | "set" | null>(initialSet ? "set" : null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isSignedIn) {
    return (
      <a
        href={signInHref}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full border border-akiba-line bg-white px-4 py-2 text-sm font-semibold text-akiba-ink transition-colors hover:border-akiba-teal/40 hover:text-akiba-teal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
      >
        <Bell className="h-4 w-4" aria-hidden="true" /> Save reminder
      </a>
    );
  }

  async function saveReminder(value: ReminderLead) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/merchant-offers/${encodeURIComponent(offerId)}/reminder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadMinutes: value }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Could not save this reminder.");
      }
      setLeadMinutes(value);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this reminder.");
    } finally {
      setPending(false);
    }
  }

  async function removeReminder() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/merchant-offers/${encodeURIComponent(offerId)}/reminder`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Could not remove this reminder.");
      }
      setLeadMinutes(null);
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this reminder.");
    } finally {
      setPending(false);
    }
  }

  const selectedLabel = leadMinutes === "set"
    ? "Reminder set"
    : REMINDER_OPTIONS.find((option) => option.value === leadMinutes)?.label;

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        disabled={pending}
        className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal disabled:cursor-wait disabled:opacity-65 ${
          leadMinutes
            ? "bg-akiba-tint text-akiba-teal"
            : "border border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal/40 hover:text-akiba-teal"
        }`}
      >
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Bell className="h-4 w-4" aria-hidden="true" />}
        {leadMinutes === "set" ? selectedLabel : selectedLabel ? `Reminder · ${selectedLabel}` : "Save reminder"}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute bottom-[calc(100%+0.5rem)] left-0 z-30 w-64 rounded-2xl border border-akiba-line bg-white p-2 shadow-xl">
          <p className="px-2 pb-1 pt-1 text-xs font-semibold text-akiba-muted">Remind me before it starts</p>
          {REMINDER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => void saveReminder(option.value)}
              className="flex min-h-10 w-full items-center rounded-xl px-2 text-left text-sm font-medium text-akiba-ink hover:bg-akiba-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              {option.label}
            </button>
          ))}
          {leadMinutes && (
            <button
              type="button"
              onClick={() => void removeReminder()}
              className="mt-1 flex min-h-10 w-full items-center gap-2 border-t border-akiba-line px-2 pt-2 text-left text-sm font-semibold text-red-700 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600"
            >
              <BellOff className="h-4 w-4" aria-hidden="true" /> Remove reminder
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 max-w-xs text-xs leading-4 text-red-700" role="alert">{error}</p>}
    </div>
  );
}

function MerchantOfferCard({
  isSingle,
  isSignedIn,
  merchantSlug,
  offer,
}: {
  isSingle: boolean;
  isSignedIn: boolean;
  merchantSlug: string;
  offer: PublicMerchantOffer;
}) {
  const availability = getMerchantOfferAvailability(offer);
  const signInHref = `/login?next=${encodeURIComponent(`/merchants/${merchantSlug}`)}`;

  return (
    <article className={`overflow-hidden rounded-2xl border border-akiba-line bg-white ${isSingle && offer.imageUrl ? "sm:grid sm:grid-cols-[minmax(13rem,0.8fr)_minmax(0,1.2fr)]" : ""}`}>
      {offer.imageUrl && (
        <div className={`relative bg-akiba-card ${isSingle ? "min-h-52 sm:min-h-full" : "aspect-[16/9]"}`}>
          <Image
            loader={passthroughLoader}
            unoptimized
            fill
            sizes={isSingle ? "(max-width: 639px) 100vw, 40vw" : "(max-width: 639px) 100vw, 50vw"}
            src={offer.imageUrl}
            alt=""
            className="object-cover"
          />
        </div>
      )}
      <div className="flex min-h-full flex-col p-4 sm:p-5">
        <p className="text-xs font-semibold text-akiba-teal">Direct offer · No AkibaMiles</p>

        <h4 className="mt-2 font-sterling text-xl font-semibold leading-tight text-akiba-ink">{offer.title}</h4>
        <p className="mt-1.5 line-clamp-3 text-sm leading-5 text-akiba-muted">{offer.description}</p>

        <div className="mt-3 text-xs">
          <span className={`font-semibold ${availability.state === "available" ? "text-akiba-teal" : "text-akiba-ink"}`}>
            {availability.label}
          </span>
          <span className="text-akiba-muted"> · {availability.scheduleLabel}</span>
        </div>

        {offer.terms && (
          <details className="mt-3 text-xs text-akiba-muted">
            <summary className="cursor-pointer font-semibold text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal">Terms</summary>
            <p className="mt-2 whitespace-pre-line leading-5">{offer.terms}</p>
          </details>
        )}

        {offer.remindersEnabled && availability.state !== "ended" && (
          <div className="mt-auto pt-4">
            <OfferReminder
              initialSet={offer.reminderSet}
              isSignedIn={isSignedIn}
              offerId={offer.id}
              signInHref={signInHref}
            />
          </div>
        )}
      </div>
    </article>
  );
}

export function MerchantOffersPanel({
  businessOffers,
  isSignedIn,
  merchantName,
  merchantSlug,
  rewardContent,
  rewardCount,
}: {
  businessOffers: PublicMerchantOffer[];
  isSignedIn: boolean;
  merchantName: string;
  merchantSlug: string;
  rewardContent: ReactNode;
  rewardCount: number;
}) {
  const [filter, setFilter] = useState<OfferFilter>("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const total = businessOffers.length + rewardCount;
  const filters: Array<{ id: OfferFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: total },
    { id: "business", label: "Business offers", count: businessOffers.length },
    { id: "akiba", label: "Akiba rewards", count: rewardCount },
  ];
  const showBusiness = filter !== "akiba";
  const showRewards = filter !== "business";
  const showBusinessGroup = showBusiness && (businessOffers.length > 0 || filter === "business");
  const showRewardsGroup = showRewards && (rewardCount > 0 || filter === "akiba");
  const showGroupLabels = filter === "all" && businessOffers.length > 0 && rewardCount > 0;

  return (
    <div>
      <div className="relative mb-3 flex items-center gap-3">
        <h3 className="font-sterling text-lg font-semibold text-akiba-ink">Offers</h3>
        <span className="ml-auto text-xs font-semibold tabular-nums text-akiba-muted">{total}</span>
        <button
          type="button"
          aria-label={filter === "all" ? "Filter offers" : `Filter offers: ${filters.find((item) => item.id === filter)?.label}`}
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen((current) => !current)}
          className={`relative flex h-11 w-11 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal ${filter === "all" ? "border-akiba-line bg-white text-akiba-ink" : "border-akiba-ink bg-akiba-ink text-white"}`}
        >
          <SlidersHorizontal className="h-4.5 w-4.5" aria-hidden="true" />
          {filter !== "all" && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-akiba-teal" />}
        </button>
        {filterOpen && (
          <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-56 rounded-2xl border border-akiba-line bg-white p-1.5 shadow-xl" role="menu" aria-label="Offer filters">
            {filters.map((item) => (
              <button
                key={item.id}
                type="button"
                role="menuitemradio"
                aria-checked={filter === item.id}
                onClick={() => { setFilter(item.id); setFilterOpen(false); }}
                className="flex min-h-11 w-full items-center justify-between rounded-xl px-3 text-left text-sm font-medium text-akiba-ink hover:bg-akiba-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
              >
                <span>{item.label}</span>
                <span className="flex items-center gap-2 text-xs tabular-nums text-akiba-muted">
                  {item.count}
                  <Check className={`h-4 w-4 text-akiba-teal ${filter === item.id ? "opacity-100" : "opacity-0"}`} aria-hidden="true" />
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {showBusinessGroup && (
        <section aria-label={`Offers from ${merchantName}`}>
          {showGroupLabels && <h4 className="mb-2 text-sm font-semibold text-akiba-ink">From {merchantName}</h4>}
          {businessOffers.length > 0 ? (
            <div className={`grid gap-3 ${businessOffers.length > 1 ? "sm:grid-cols-2" : ""}`}>
              {businessOffers.map((offer) => (
                <MerchantOfferCard
                  key={offer.id}
                  isSingle={businessOffers.length === 1}
                  isSignedIn={isSignedIn}
                  merchantSlug={merchantSlug}
                  offer={offer}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-akiba-line bg-white px-5 py-7 text-center text-sm text-akiba-muted">
              No direct offers right now.
            </div>
          )}
        </section>
      )}

      {showRewardsGroup && (
        <section className={showBusinessGroup && businessOffers.length > 0 ? "mt-6 border-t border-akiba-line pt-5" : ""} aria-label="Akiba rewards">
          {showGroupLabels && <h4 className="mb-2 text-sm font-semibold text-akiba-ink">Akiba rewards</h4>}
          {rewardCount > 0 ? rewardContent : (
            <div className="rounded-2xl border border-akiba-line bg-white px-5 py-7 text-center text-sm text-akiba-muted">
              No Akiba rewards right now.
            </div>
          )}
        </section>
      )}
    </div>
  );
}
