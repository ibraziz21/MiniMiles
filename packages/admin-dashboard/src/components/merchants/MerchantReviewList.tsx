"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ChevronRight, Search, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { reviewHref } from "@/lib/queueNavigation";
import { directoryStatusLabel } from "@/lib/merchant-directory-review";
import {
  reviewKind,
  reviewListFilters,
  type MerchantReviewRow,
} from "@/lib/merchantReviewList";

export function MerchantReviewList({
  rows,
  limited,
  locationsUnavailable = false,
}: {
  rows: MerchantReviewRow[];
  limited: boolean;
  locationsUnavailable?: boolean;
}) {
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [kind, setKind] = useState(params.get("kind") ?? "all");
  useEffect(() => {
    setQuery(params.get("q") ?? "");
    setKind(params.get("kind") ?? "all");
  }, [params]);
  const pending = rows.filter((row) => row.status === "pending_review");
  const filtered = reviewListFilters(rows, query, kind);
  const history = rows.filter(
    (row) =>
      row.status !== "pending_review" &&
      `${row.name} ${row.location}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
  );
  const back = `/directory-reviews${params.size ? `?${params}` : ""}`;
  function update(key: string, value: string) {
    const next = new URLSearchParams(window.location.search);
    if (!value || (key === "kind" && value === "all")) next.delete(key);
    else next.set(key, value);
    window.history.replaceState(
      null,
      "",
      `/directory-reviews${next.size ? `?${next}` : ""}`
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          Awaiting review
        </h2>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-sm tabular-nums text-primary-strong">
          {pending.length}
        </span>
      </div>
      <label className="flex min-h-11 items-center gap-2 rounded-control border border-border bg-white px-3 focus-within:ring-2 focus-within:ring-primary">
        <Search
          className="h-4 w-4 shrink-0 text-ink-muted"
          aria-hidden="true"
        />
        <span className="sr-only">Search merchant reviews</span>
        <input
          name="q"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            update("q", event.target.value);
          }}
          placeholder="Merchant or location…"
          className="h-11 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-muted"
        />
      </label>
      <div
        role="group"
        aria-label="Submission type"
        className="flex flex-wrap gap-2"
      >
        {[
          { id: "all", label: "All" },
          { id: "new", label: "New profiles" },
          { id: "updates", label: "Updates" },
        ].map((filter) => (
          <button
            type="button"
            key={filter.id}
            aria-pressed={kind === filter.id}
            onClick={() => {
              setKind(filter.id);
              update("kind", filter.id);
            }}
            className={cn(
              "min-h-11 rounded-full px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              kind === filter.id
                ? "bg-primary text-white"
                : "bg-white text-ink-muted hover:bg-surface-subtle"
            )}
          >
            {filter.label}{" "}
            <span className="tabular-nums">
              {filter.id === "all"
                ? pending.length
                : pending.filter((row) => reviewKind(row) === filter.id).length}
            </span>
          </button>
        ))}
      </div>
      {locationsUnavailable && (
        <p role="status" className="text-sm text-ink-muted">
          Location details are unavailable.
        </p>
      )}
      {filtered.length > 0 ? (
        <ul className="space-y-2">
          {filtered.map((row) => (
            <li key={row.id}>
              <Link
                href={reviewHref(row.id, back)}
                className="flex min-h-24 items-center gap-3 rounded-card border border-border bg-white p-4 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-base font-semibold text-ink">
                    {row.name}
                  </span>
                  {row.location && (
                    <span className="mt-1 block break-words text-sm text-ink-muted">
                      {row.location}
                    </span>
                  )}
                  <span className="mt-2 block text-sm text-ink-muted">
                    {reviewKind(row) === "new"
                      ? "New profile"
                      : "Profile update"}
                    {row.submittedAt
                      ? ` · ${new Date(row.submittedAt).toLocaleDateString(
                          "en-KE",
                          {
                            day: "numeric",
                            month: "short",
                            timeZone: "Africa/Nairobi",
                          }
                        )}`
                      : ""}
                  </span>
                </span>
                <ChevronRight
                  className="h-5 w-5 shrink-0 text-ink-muted"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-card border border-border bg-white p-8 text-center">
          <CheckCircle2
            className="mx-auto mb-3 h-8 w-8 text-primary"
            aria-hidden="true"
          />
          <h3 className="text-lg font-semibold text-ink">
            {pending.length ? "No matching submissions" : "No pending reviews"}
          </h3>
          {(query || kind !== "all") && (
            <button
              onClick={() => {
                setQuery("");
                setKind("all");
                window.history.replaceState(null, "", "/directory-reviews");
              }}
              className="mt-3 min-h-11 rounded-control px-3 text-sm text-primary underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              Clear filters
            </button>
          )}
        </div>
      )}
      {limited && (
        <p className="text-sm text-ink-muted">
          Showing up to 500 pending profiles.
        </p>
      )}
      <details className="rounded-card border border-border bg-white p-4">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          Other profiles · latest 100
        </summary>
        <ul className="divide-y divide-border">
          {history.map((row) => (
            <li key={row.id}>
              <Link
                href={reviewHref(row.id, back)}
                className="flex min-h-14 items-center justify-between gap-3 rounded-control py-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className="min-w-0 break-words font-medium text-ink">
                  {row.name}
                </span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {directoryStatusLabel(row.status)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
        {!history.length && (
          <p className="py-3 text-sm text-ink-muted">
            No other matching profiles.
          </p>
        )}
      </details>
    </div>
  );
}
