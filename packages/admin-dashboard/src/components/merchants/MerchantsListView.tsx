"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Store, Search, ChevronRight } from "lucide-react";
import { directoryStatusLabel } from "@/lib/merchant-directory-review";
import { cn } from "@/lib/utils";

export interface MerchantRow {
  id: string;
  status: string;
  name: string;
  country: string | null;
  image_url: string | null;
  location?: string;
  directory_status?: string | null;
  subscription: { plan: string; status: string } | null;
  voucher_types: number;
  active_voucher_types: number;
  team_count: number;
}
const filters = [
  ["all", "All"],
  ["published", "Published"],
  ["changes_requested", "Changes requested"],
  ["trial", "Trial"],
  ["archived", "Archived"],
];
export function MerchantsListView({
  merchants,
}: {
  merchants: MerchantRow[];
  canManage?: boolean;
}) {
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get("q") ?? "");
  const validView = (value: string | null) =>
    filters.some(([id]) => id === value) ? value! : "all";
  const [view, setView] = useState(validView(params.get("view")));
  useEffect(() => {
    setSearch(params.get("q") ?? "");
    setView(validView(params.get("view")));
  }, [params]);
  function update(key: string, value: string) {
    const next = new URLSearchParams(window.location.search);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    window.history.replaceState(
      null,
      "",
      `/merchants${next.size ? `?${next}` : ""}`
    );
  }
  const filtered = useMemo(
    () =>
      merchants.filter(
        (m) =>
          (view === "archived"
            ? m.status === "archived"
            : m.status !== "archived") &&
          (view === "published"
            ? m.directory_status === "published"
            : view === "changes_requested"
            ? m.directory_status === "changes_requested"
            : view === "trial"
            ? m.subscription?.status === "trialing"
            : true) &&
          `${m.name} ${m.location ?? m.country ?? ""}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
      ),
    [merchants, view, search]
  );
  const back = `/merchants${params.size ? `?${params}` : ""}`;
  return (
    <div className="space-y-4">
      <label className="flex min-h-11 items-center gap-2 rounded-control border border-border bg-white px-3 focus-within:ring-2 focus-within:ring-primary">
        <Search
          className="h-4 w-4 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
        <span className="sr-only">Search merchants</span>
        <input
          type="search"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            update("q", e.target.value);
          }}
          placeholder="Merchant or location…"
          className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none"
        />
      </label>
      <div
        role="group"
        aria-label="Merchant status"
        className="flex gap-2 overflow-x-auto pb-1"
      >
        {filters.map(([id, label]) => (
          <button
            key={id}
            aria-pressed={view === id}
            onClick={() => {
              setView(id);
              update("view", id);
            }}
            className={cn(
              "min-h-11 shrink-0 rounded-full px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              view === id ? "bg-primary text-white" : "bg-white text-ink"
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p role="status" className="text-sm text-ink-muted">
        {filtered.length} merchants
      </p>
      {filtered.length ? (
        <ul className="divide-y divide-[#EAEDFF] overflow-hidden rounded-card bg-white shadow-sm">
          {filtered.map((m) => (
            <li key={m.id}>
              <Link
                href={`/merchants/${m.id}?returnTo=${encodeURIComponent(back)}`}
                className="flex items-center gap-4 px-4 py-5 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
              >
                <span className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-control bg-surface-subtle">
                  {m.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={m.image_url}
                      alt=""
                      width={56}
                      height={56}
                      loading="lazy"
                      className="h-14 w-14 object-cover"
                    />
                  ) : (
                    <Store
                      className="h-5 w-5 text-primary"
                      aria-hidden="true"
                    />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold text-ink">
                    {m.name}
                  </span>
                  <span className="block text-sm text-ink-muted">
                    {m.location || m.country || "Location not supplied"}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-2 text-xs text-ink">
                    <span className="rounded-full bg-[#DAE2FD] px-2 py-0.5">
                      {m.status === "archived"
                        ? "Archived"
                        : m.directory_status
                        ? directoryStatusLabel(m.directory_status)
                        : "No public profile"}
                    </span>
                    {m.subscription && (
                      <span className="rounded-full bg-[#EAEDFF] px-2 py-0.5 capitalize">
                        {m.subscription.status === "trialing"
                          ? "Trial"
                          : `${
                              m.subscription.plan
                            } · ${m.subscription.status.replaceAll("_", " ")}`}
                      </span>
                    )}
                  </span>
                </span>
                <span className="hidden text-sm text-ink-muted sm:block">
                  {m.active_voucher_types} active vouchers
                </span>
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-ink-muted"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-card bg-white shadow-sm p-6 text-sm text-ink-muted">
          No merchants match. Try another search or filter.
        </div>
      )}
    </div>
  );
}
