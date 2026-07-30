"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, Store, MapPin, X, LocateFixed, Globe, RefreshCw, Loader2 } from "lucide-react";
import clsx from "clsx";
import { MerchantCard } from "@/components/merchants/MerchantCard";
import { track } from "@/lib/analytics/track";
import type { PublicMerchantSummary } from "@/lib/merchants/types";

type Category = { slug: string; name: string };
type Mode = "all" | "physical" | "online";

type Filters = { q: string; category: string; city: string; mode: Mode };

function buildQuery(filters: Filters, nearMe: { lat: number; lng: number } | null): string {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.category) params.set("category", filters.category);
  if (filters.city) params.set("city", filters.city);
  if (filters.mode !== "all") params.set("mode", filters.mode);
  if (nearMe) {
    params.set("lat", String(nearMe.lat));
    params.set("lng", String(nearMe.lng));
  }
  return params.toString();
}

export function MerchantFilters({
  initialMerchants,
  initialNextCursor,
  categories,
  cities,
  initialFilters,
}: {
  initialMerchants: PublicMerchantSummary[];
  initialNextCursor: string | null;
  categories: Category[];
  cities: string[];
  initialFilters: Filters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(() => {
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    return lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;
  });
  const [nearMeStatus, setNearMeStatus] = useState<"idle" | "locating" | "denied">("idle");

  const [merchants, setMerchants] = useState(initialMerchants);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);

  const isFirstRun = useRef(true);

  useEffect(() => {
    track("merchant_directory_view");
  }, []);

  const fetchMerchants = useCallback(
    async (f: Filters, near: { lat: number; lng: number } | null, cursor?: string) => {
      const params = new URLSearchParams(buildQuery(f, near));
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`/api/merchants?${params.toString()}`);
      if (!res.ok) throw new Error("directory_unavailable");
      return (await res.json()) as { merchants: PublicMerchantSummary[]; next_cursor: string | null };
    },
    []
  );

  // Sync filters -> URL (shareable/back-forward capable) and re-fetch.
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const query = buildQuery(filters, nearMe);
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });

    const handle = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const data = await fetchMerchants(filters, nearMe);
        setMerchants(data.merchants);
        setNextCursor(data.next_cursor);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, nearMe]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchMerchants(filters, nearMe, nextCursor);
      setMerchants((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...data.merchants.filter((m) => !seen.has(m.id))];
      });
      setNextCursor(data.next_cursor);
    } catch {
      setError(true);
    } finally {
      setLoadingMore(false);
    }
  }

  async function retry() {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchMerchants(filters, nearMe);
      setMerchants(data.merchants);
      setNextCursor(data.next_cursor);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  function handleNearMe() {
    if (nearMe) {
      setNearMe(null);
      return;
    }
    setNearMeStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setNearMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setNearMeStatus("idle");
        track("merchant_near_me_enable");
      },
      () => setNearMeStatus("denied"),
      { enableHighAccuracy: false, timeout: 8000 }
    );
  }

  function setCategory(next: string) {
    setFilters((f) => ({ ...f, category: next }));
    track("merchant_category_filter", { category: next || null });
  }

  function setCity(next: string) {
    setFilters((f) => ({ ...f, city: next }));
    track("merchant_city_filter", { city: next || null });
  }

  function setMode(next: Mode) {
    setFilters((f) => ({ ...f, mode: next }));
  }

  function setSearch(next: string) {
    setFilters((f) => ({ ...f, q: next }));
  }

  // Debounced, content-free search event — never logs the raw query text.
  useEffect(() => {
    if (isFirstRun.current) return;
    const handle = setTimeout(() => {
      track("merchant_search", { hasQuery: filters.q.length > 0 });
    }, 400);
    return () => clearTimeout(handle);
  }, [filters.q]);

  const hasFilter = filters.q || filters.category || filters.city || filters.mode !== "all" || nearMe;

  function clearAll() {
    setFilters({ q: "", category: "", city: "", mode: "all" });
    setNearMe(null);
  }

  return (
    <div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-akiba-muted" />
          <input
            type="text"
            aria-label="Search merchants, categories, cities"
            placeholder="Search merchants, categories, cities…"
            value={filters.q}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-akiba-line bg-white py-2.5 pl-9 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal focus:border-akiba-teal"
          />
          {filters.q && (
            <button
              aria-label="Clear search"
              onClick={() => setSearch("")}
              className="absolute right-3 top-2.5 text-akiba-muted hover:text-akiba-ink focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          onClick={handleNearMe}
          aria-pressed={!!nearMe}
          className={clsx(
            "flex items-center justify-center gap-1.5 rounded-xl border px-4 py-2.5 text-sm font-semibold transition focus-visible:ring-2 focus-visible:ring-akiba-teal",
            nearMe
              ? "border-akiba-teal bg-akiba-teal text-white"
              : "border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal/40"
          )}
        >
          <LocateFixed className="h-4 w-4" />
          {nearMeStatus === "locating" ? "Locating…" : nearMe ? "Near me on" : "Near me"}
        </button>
      </div>

      {nearMeStatus === "denied" && (
        <p className="mb-4 text-xs text-akiba-muted" role="status">
          Location permission was denied — you can still browse by category and city.
        </p>
      )}

      {/* Operating-model filter */}
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by operating model">
        {([
          { value: "all", label: "All", icon: <Store className="h-3 w-3" /> },
          { value: "physical", label: "In store", icon: <Store className="h-3 w-3" /> },
          { value: "online", label: "Online", icon: <Globe className="h-3 w-3" /> },
        ] as const).map((opt) => (
          <FilterChip
            key={opt.value}
            label={opt.label}
            icon={opt.icon}
            active={filters.mode === opt.value}
            onClick={() => setMode(opt.value)}
          />
        ))}
      </div>

      {cities.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Filter by city">
          <FilterChip label="All cities" icon={<MapPin className="h-3 w-3" />} active={!filters.city} onClick={() => setCity("")} />
          {cities.map((c) => (
            <FilterChip key={c} label={c} icon={<MapPin className="h-3 w-3" />} active={filters.city === c} onClick={() => setCity(filters.city === c ? "" : c)} />
          ))}
        </div>
      )}

      {categories.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          <FilterChip label="All categories" icon={<Store className="h-3 w-3" />} active={!filters.category} onClick={() => setCategory("")} />
          {categories.map((c) => (
            <FilterChip key={c.slug} label={c.name} active={filters.category === c.slug} onClick={() => setCategory(filters.category === c.slug ? "" : c.slug)} />
          ))}
        </div>
      )}

      {error ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white py-14 text-center">
          <Store className="mb-3 h-10 w-10 text-akiba-line" />
          <p className="font-medium text-akiba-ink">Merchants are temporarily unavailable</p>
          <button
            onClick={retry}
            className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </button>
        </div>
      ) : loading ? (
        <SkeletonGrid />
      ) : merchants.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-akiba-line bg-white py-14 text-center">
          <Store className="mb-3 h-10 w-10 text-akiba-line" />
          <p className="font-medium text-akiba-ink">No merchants match</p>
          {hasFilter && (
            <button onClick={clearAll} className="mt-3 text-sm font-semibold text-akiba-teal focus-visible:ring-2 focus-visible:ring-akiba-teal">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {merchants.map((m) => (
              <MerchantCard key={m.id} merchant={m} />
            ))}
          </div>
          {nextCursor && (
            <div className="mt-8 flex justify-center">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-full border border-akiba-line bg-white px-5 py-2.5 text-sm font-semibold text-akiba-ink transition hover:border-akiba-teal/40 focus-visible:ring-2 focus-visible:ring-akiba-teal disabled:opacity-60"
              >
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {loadingMore ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading merchants">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-64 animate-pulse rounded-2xl border border-akiba-line bg-akiba-card" />
      ))}
    </div>
  );
}

function FilterChip({ label, icon, active, onClick }: { label: string; icon?: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-akiba-teal",
        active
          ? "border-akiba-teal bg-akiba-teal text-white"
          : "border-akiba-line bg-white text-akiba-muted hover:border-akiba-teal/40 hover:text-akiba-ink"
      )}
    >
      {icon} {label}
    </button>
  );
}
