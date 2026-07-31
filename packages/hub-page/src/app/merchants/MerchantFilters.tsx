"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Search, Store, MapPin, X, LocateFixed, Globe, RefreshCw, Loader2, SlidersHorizontal } from "lucide-react";
import clsx from "clsx";
import { MerchantValueCard } from "@/components/home/MerchantValueCard";
import { track } from "@/lib/analytics/track";
import type { MerchantValueSummary } from "@/lib/home/types";

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
  initialMerchants: MerchantValueSummary[];
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
      return (await res.json()) as { merchants: MerchantValueSummary[]; next_cursor: string | null };
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
  const activeFilterCount =
    (filters.mode !== "all" ? 1 : 0) + (filters.city ? 1 : 0) + (filters.category ? 1 : 0);

  function clearAll() {
    setFilters({ q: "", category: "", city: "", mode: "all" });
    setNearMe(null);
  }

  const [sheetOpen, setSheetOpen] = useState(false);
  const hasSheetFilters = cities.length > 1 || categories.length > 0;

  return (
    <div>
      {/* One compact, always-visible row — search, near-me, and everything
          else (mode/city/category) tucked behind "Filters" so the page
          doesn't need scrolling just to get past the controls. */}
      <div className="sticky top-16 z-30 -mx-4 border-b border-akiba-line bg-akiba-paper/95 px-4 py-3 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-akiba-muted" />
            <input
              type="text"
              aria-label="Search merchants, categories, cities"
              placeholder="Search merchants…"
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
            aria-label="Use my location"
            aria-pressed={!!nearMe}
            className={clsx(
              "flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border transition focus-visible:ring-2 focus-visible:ring-akiba-teal",
              nearMe
                ? "border-akiba-teal bg-akiba-teal text-white"
                : "border-akiba-line bg-white text-akiba-ink hover:border-akiba-teal/40"
            )}
          >
            {nearMeStatus === "locating" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
          </button>

          {hasSheetFilters && (
            <button
              onClick={() => setSheetOpen(true)}
              className="relative flex h-[42px] shrink-0 items-center gap-1.5 rounded-xl border border-akiba-line bg-white px-3.5 text-sm font-semibold text-akiba-ink transition hover:border-akiba-teal/40 focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <SlidersHorizontal className="h-4 w-4" /> Filters
              {activeFilterCount > 0 && (
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-akiba-teal text-[10px] font-bold text-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
          )}
        </div>

        {nearMeStatus === "denied" && (
          <p className="mt-2 text-xs text-akiba-muted" role="status">
            Location permission was denied — you can still browse by category and city.
          </p>
        )}
      </div>

      <FiltersSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        setMode={setMode}
        setCity={setCity}
        setCategory={setCategory}
        cities={cities}
        categories={categories}
        onClearAll={clearAll}
      />

      <div className="pt-4">
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
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
            {merchants.map((m, i) => (
              <MerchantValueCard
                key={m.id}
                merchant={m}
                sectionId="directory"
                position={i}
                event="merchant_directory_card_tap"
                eventProps={{ merchant_id: m.id, position: i, reason_kinds: m.reasons.map((r) => r.kind) }}
              />
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
    </div>
  );
}

/**
 * Mode/city/category live here instead of inline chip rows — with a full
 * category taxonomy (a dozen-plus categories) plus every directory city,
 * showing them all inline was the "too many categories" clutter problem.
 * A sheet keeps the persistent page chrome to one compact row.
 */
function FiltersSheet({
  open,
  onClose,
  filters,
  setMode,
  setCity,
  setCategory,
  cities,
  categories,
  onClearAll,
}: {
  open: boolean;
  onClose: () => void;
  filters: Filters;
  setMode: (m: Mode) => void;
  setCity: (c: string) => void;
  setCategory: (c: string) => void;
  cities: string[];
  categories: Category[];
  onClearAll: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div className="relative max-h-[85vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-md sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-sterling text-lg font-semibold text-akiba-ink">Filters</h2>
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="flex h-8 w-8 items-center justify-center rounded-full text-akiba-muted hover:bg-akiba-card hover:text-akiba-ink focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-akiba-muted">Where</p>
          <div className="flex gap-2" role="group" aria-label="Filter by operating model">
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
        </div>

        {cities.length > 1 && (
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-akiba-muted">City</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by city">
              <FilterChip label="All cities" icon={<MapPin className="h-3 w-3" />} active={!filters.city} onClick={() => setCity("")} />
              {cities.map((c) => (
                <FilterChip key={c} label={c} icon={<MapPin className="h-3 w-3" />} active={filters.city === c} onClick={() => setCity(filters.city === c ? "" : c)} />
              ))}
            </div>
          </div>
        )}

        {categories.length > 0 && (
          <div className="mb-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-akiba-muted">Category</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by category">
              <FilterChip label="All categories" icon={<Store className="h-3 w-3" />} active={!filters.category} onClick={() => setCategory("")} />
              {categories.map((c) => (
                <FilterChip key={c.slug} label={c.name} active={filters.category === c.slug} onClick={() => setCategory(filters.category === c.slug ? "" : c.slug)} />
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            onClick={onClearAll}
            className="flex-1 rounded-full border border-akiba-line py-2.5 text-sm font-semibold text-akiba-ink transition hover:border-akiba-teal/40 focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            Clear all
          </button>
          <button
            onClick={onClose}
            className="flex-1 rounded-full bg-akiba-teal py-2.5 text-sm font-semibold text-white transition hover:bg-[#1E7E8D] focus-visible:ring-2 focus-visible:ring-akiba-ink"
          >
            Show results
          </button>
        </div>
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3" aria-busy="true" aria-label="Loading merchants">
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
        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition focus-visible:ring-2 focus-visible:ring-akiba-teal",
        active
          ? "border-akiba-teal bg-akiba-teal text-white"
          : "border-akiba-line bg-white text-akiba-muted hover:border-akiba-teal/40 hover:text-akiba-ink"
      )}
    >
      {icon} {label}
    </button>
  );
}
