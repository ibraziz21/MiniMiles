"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ChevronRight,
  Search,
  Store,
  ImageIcon,
  Flag,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { reviewHref } from "@/lib/queueNavigation";
import { type QueueItem } from "@/lib/queueTypes";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "profile_reviews", label: "Merchants" },
  { id: "discovery_photos", label: "Photos" },
  { id: "discovery_reports", label: "Reports" },
] as const;
function age(minutes: number) {
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

export function UnifiedQueueView({
  items,
  canBrowseVisits = false,
}: {
  items: QueueItem[];
  canBrowseVisits?: boolean;
}) {
  const params = useSearchParams();
  const pathname = usePathname();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const source = params.get("type") ?? "all";
  const [type, setType] = useState(source);
  const [sort, setSort] = useState(params.get("sort") ?? "oldest");
  const [ageFilter, setAgeFilter] = useState(params.get("age") ?? "any");
  useEffect(() => {
    setQuery(params.get("q") ?? "");
    setType(params.get("type") ?? "all");
    setSort(params.get("sort") ?? "oldest");
    setAgeFilter(params.get("age") ?? "any");
  }, [params]);
  const pending = useMemo(
    () => items.filter((item) => item.state === "open"),
    [items]
  );
  const filtered = useMemo(
    () =>
      pending
        .filter((item) => {
          const matchesAge =
            ageFilter === "any" ||
            (ageFilter === "lt1h"
              ? item.ageMinutes < 60
              : ageFilter === "lt24h"
              ? item.ageMinutes < 1440
              : ageFilter === "gt24h"
              ? item.ageMinutes >= 1440
              : item.ageMinutes >= 4320);
          return (
            (type === "all" || item.source === type) &&
            matchesAge &&
            `${item.title} ${item.subtitle ?? ""}`
              .toLowerCase()
              .includes(query.trim().toLowerCase())
          );
        })
        .sort((a, b) =>
          sort === "newest"
            ? a.ageMinutes - b.ageMinutes
            : b.ageMinutes - a.ageMinutes
        ),
    [pending, type, query, sort, ageFilter]
  );

  function update(key: string, value: string) {
    const next = new URLSearchParams(window.location.search);
    if (
      !value ||
      (key === "type" && value === "all") ||
      (key === "sort" && value === "oldest") ||
      (key === "age" && value === "any")
    )
      next.delete(key);
    else next.set(key, value);
    window.history.replaceState(
      null,
      "",
      `${pathname}${next.size ? `?${next}` : ""}`
    );
  }
  const returnTo = `${pathname}${params.size ? `?${params}` : ""}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h2 className="text-[28px] font-semibold tracking-tight text-ink">
            Reviews
          </h2>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-sm font-medium tabular-nums text-primary-strong">
            {pending.length}
            {pending.length >= 150 ? "+" : ""}
          </span>
        </div>
        {canBrowseVisits && (
          <Link
            href="/verified-visits"
            className="inline-flex min-h-11 items-center gap-1 rounded-control px-2 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:bg-surface-subtle"
          >
            Verified visits
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
      <label className="flex h-11 items-center gap-2 rounded-control border border-border bg-white px-3 focus-within:ring-2 focus-within:ring-primary">
        <Search
          className="h-4 w-4 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
        <span className="sr-only">Search queue</span>
        <input
          type="search"
          name="q"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            update("q", e.target.value);
          }}
          placeholder="Merchant or keyword…"
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
        />
      </label>
      <div
        role="group"
        aria-label="Review type"
        className="flex flex-wrap gap-2"
      >
        {FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            aria-pressed={type === filter.id}
            onClick={() => {
              setType(filter.id);
              update("type", filter.id);
            }}
            className={cn(
              "flex min-h-11 min-w-0 items-center justify-center gap-1 rounded-full px-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-4",
              type === filter.id
                ? "bg-primary text-white"
                : "bg-white text-ink-muted hover:bg-surface-subtle"
            )}
          >
            <span>{filter.label}</span>
            <span className="tabular-nums">
              {filter.id === "all"
                ? pending.length
                : pending.filter((i) => i.source === filter.id).length}
            </span>
          </button>
        ))}
      </div>
      <details className="text-sm text-ink-muted">
        <summary className="flex min-h-11 cursor-pointer items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {sort === "newest" ? "Newest first" : "Oldest first"} · Filter & sort
        </summary>
        <div className="flex flex-wrap gap-3 pb-2">
          <label className="flex items-center gap-2">
            Order
            <select
              name="sort"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                update("sort", e.target.value);
              }}
              className="min-h-11 rounded-control border border-border bg-white px-2 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="oldest">Oldest first</option>
              <option value="newest">Newest first</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            Age
            <select
              name="age"
              value={ageFilter}
              onChange={(e) => {
                setAgeFilter(e.target.value);
                update("age", e.target.value);
              }}
              className="min-h-11 rounded-control border border-border bg-white px-2 text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <option value="any">Any age</option>
              <option value="lt1h">Under 1 hour</option>
              <option value="lt24h">Under 24 hours</option>
              <option value="gt24h">Over 24 hours</option>
              <option value="gt3d">Over 3 days</option>
            </select>
          </label>
        </div>
      </details>
      {filtered.length ? (
        <ul className="space-y-2">
          {filtered.map((item) => {
            const Icon =
              item.source === "profile_reviews"
                ? Store
                : item.source === "discovery_photos"
                ? ImageIcon
                : Flag;
            const content = (
              <>
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-base font-medium text-ink">
                    {item.title}
                  </span>
                  <span className="mt-1 block text-sm text-ink-muted">
                    {FILTERS.find((f) => f.id === item.source)?.label} ·{" "}
                    {age(item.ageMinutes)}
                  </span>
                </span>
                <ChevronRight
                  className="h-5 w-5 shrink-0 text-ink-muted"
                  aria-hidden="true"
                />
              </>
            );
            let href =
              item.source === "profile_reviews" && item.href
                ? reviewHref(item.href.split("/").pop()!, returnTo)
                : item.href;
            if (
              href &&
              (item.source === "discovery_photos" ||
                item.source === "discovery_reports")
            ) {
              const target = new URL(href, "https://admin.invalid");
              target.searchParams.set("returnTo", returnTo);
              href = target.pathname + target.search;
            }
            return (
              <li key={item.key}>
                {href ? (
                  <Link
                    href={href}
                    className="flex min-h-20 items-center gap-3 rounded-card border border-border bg-white p-4 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {content}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 rounded-card border border-border bg-white p-4">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-card border border-border bg-white px-5 py-12 text-center">
          <CheckCircle2
            className="mx-auto mb-3 h-8 w-8 text-primary"
            aria-hidden="true"
          />
          <h3 className="text-lg font-semibold text-ink">
            {pending.length ? "No matching reviews" : "No pending reviews"}
          </h3>
          {pending.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setType("all");
                setAgeFilter("any");
                window.history.replaceState(null, "", pathname);
              }}
              className="mt-3 min-h-11 rounded-control px-3 text-sm font-medium text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      {pending.length >= 150 && (
        <p className="text-xs text-ink-muted">
          Up to 150 reviews per category. Use the category’s full review list
          for older records.
        </p>
      )}
    </div>
  );
}
