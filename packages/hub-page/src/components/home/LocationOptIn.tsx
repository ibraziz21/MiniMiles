"use client";

import { useState } from "react";
import { LocateFixed, MapPin } from "lucide-react";
import { track } from "@/lib/analytics/track";
import { MerchantRail } from "./MerchantRail";
import type { HomeFeedSection } from "@/lib/home/types";

type Status = "idle" | "locating" | "granted" | "denied" | "unavailable";

/**
 * Opt-in control for the Nearby section (spec §6.4). The browser permission
 * prompt fires only from the "Use my location" tap — never on mount/focus.
 * Coordinates are used for one client-side feed re-fetch and are never
 * persisted (no profile field, no analytics payload, no long-lived log).
 */
export function LocationOptIn({ cities }: { cities: string[] }) {
  const [status, setStatus] = useState<Status>("idle");
  const [section, setSection] = useState<HomeFeedSection | null>(null);

  function handleUseLocation() {
    track("home_location_prompt_tap");
    setStatus("locating");
    if (!("geolocation" in navigator)) {
      setStatus("unavailable");
      track("home_location_result", { outcome: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        track("home_location_result", { outcome: "granted" });
        try {
          const res = await fetch(
            `/api/home/feed?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`
          );
          if (!res.ok) throw new Error("feed_unavailable");
          const data = await res.json();
          const nearby = (data.sections ?? []).find((s: HomeFeedSection) => s.id === "nearby") ?? null;
          setSection(nearby);
          setStatus("granted");
        } catch {
          setStatus("granted");
          setSection(null);
        }
      },
      () => {
        setStatus("denied");
        track("home_location_result", { outcome: "denied" });
      },
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  if (status === "granted") {
    if (!section) return null;
    return <MerchantRail section={section} />;
  }

  if (status === "denied" || status === "unavailable") {
    if (cities.length === 0) return null;
    return (
      <section className="mb-8" aria-live="polite">
        <h2 className="mb-3 font-sterling text-lg font-semibold text-akiba-ink">Browse by city</h2>
        <div className="flex flex-wrap gap-2">
          {cities.slice(0, 6).map((city) => (
            <a
              key={city}
              href={`/merchants?city=${encodeURIComponent(city)}`}
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-akiba-line bg-white px-3 py-2 text-xs font-medium text-akiba-ink hover:border-akiba-teal/40 active:bg-akiba-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <MapPin className="h-3 w-3" /> {city}
            </a>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="mb-8 flex flex-col gap-3 rounded-2xl border border-dashed border-akiba-teal/30 bg-akiba-tint/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-akiba-teal shadow-chip">
          <MapPin className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="font-semibold text-akiba-ink">See what&apos;s nearby</p>
          <p className="mt-0.5 text-sm text-akiba-muted">Find Akiba merchants around you.</p>
        </div>
      </div>
      <button
        onClick={handleUseLocation}
        disabled={status === "locating"}
        className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-akiba-ink px-4 py-2 text-sm font-semibold text-white transition hover:bg-akiba-teal active:scale-[0.98] disabled:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus-visible:ring-offset-2"
      >
        <LocateFixed className="h-4 w-4" />
        {status === "locating" ? "Locating…" : "Use my location"}
      </button>
    </section>
  );
}
