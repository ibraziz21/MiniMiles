"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Clock, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { QUEUE_SOURCE_LABELS, type QueueItem, type QueueSourceId } from "@/lib/unifiedQueue";

type SavedView = "all" | "mine" | "urgent" | "waiting" | "resolved";

const SAVED_VIEWS: Array<{ id: SavedView; label: string }> = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "urgent", label: "Urgent" },
  { id: "waiting", label: "Waiting" },
  { id: "resolved", label: "Resolved" },
];

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

const AGE_FILTERS = [
  { id: "any", label: "Any age" },
  { id: "lt1h", label: "< 1 hour" },
  { id: "lt24h", label: "< 24 hours" },
  { id: "gt24h", label: "> 24 hours" },
  { id: "gt3d", label: "> 3 days" },
] as const;

function matchesAgeFilter(minutes: number, filter: (typeof AGE_FILTERS)[number]["id"]): boolean {
  switch (filter) {
    case "lt1h":
      return minutes < 60;
    case "lt24h":
      return minutes < 60 * 24;
    case "gt24h":
      return minutes >= 60 * 24;
    case "gt3d":
      return minutes >= 60 * 24 * 3;
    default:
      return true;
  }
}

interface UnifiedQueueViewProps {
  items: QueueItem[];
  currentAdminId: string;
}

export function UnifiedQueueView({ items, currentAdminId }: UnifiedQueueViewProps) {
  const [view, setView] = useState<SavedView>("all");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<QueueSourceId | "all">("all");
  const [ageFilter, setAgeFilter] = useState<(typeof AGE_FILTERS)[number]["id"]>("any");

  const viewCounts = useMemo(() => {
    const open = items.filter((i) => i.state === "open");
    return {
      all: open.length,
      mine: open.filter((i) => i.assigneeId === currentAdminId).length,
      urgent: open.filter((i) => i.urgent).length,
      waiting: open.filter((i) => !i.assigneeId).length,
      resolved: items.filter((i) => i.state === "resolved").length,
    };
  }, [items, currentAdminId]);

  const filtered = useMemo(() => {
    let rows = items;

    if (view === "resolved") {
      rows = rows.filter((i) => i.state === "resolved");
    } else {
      rows = rows.filter((i) => i.state === "open");
      if (view === "mine") rows = rows.filter((i) => i.assigneeId === currentAdminId);
      if (view === "urgent") rows = rows.filter((i) => i.urgent);
      if (view === "waiting") rows = rows.filter((i) => !i.assigneeId);
    }

    if (sourceFilter !== "all") rows = rows.filter((i) => i.source === sourceFilter);
    if (ageFilter !== "any") rows = rows.filter((i) => matchesAgeFilter(i.ageMinutes, ageFilter));
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter(
        (i) => i.title.toLowerCase().includes(q) || i.subtitle?.toLowerCase().includes(q),
      );
    }

    return [...rows].sort((a, b) => {
      if (a.urgent !== b.urgent) return a.urgent ? -1 : 1;
      return b.ageMinutes - a.ageMinutes;
    });
  }, [items, view, sourceFilter, ageFilter, search, currentAdminId]);

  const sourcesPresent = useMemo(
    () => Array.from(new Set(items.map((i) => i.source))) as QueueSourceId[],
    [items],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Saved views">
        {SAVED_VIEWS.map((v) => (
          <button
            key={v.id}
            role="tab"
            aria-selected={view === v.id}
            onClick={() => setView(v.id)}
            className={cn(
              "min-h-[36px] rounded-control px-3 text-sm font-medium transition-colors",
              view === v.id ? "bg-primary text-white" : "bg-surface-subtle text-ink-muted hover:text-ink",
            )}
          >
            {v.label} ({viewCounts[v.id]})
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or details…"
          aria-label="Search queue items"
          className="h-9 min-w-[200px] flex-1 rounded-control border border-border bg-surface px-3 text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:ring-2 focus:ring-primary"
        />
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as QueueSourceId | "all")}
          aria-label="Filter by type"
          className="h-9 rounded-control border border-border bg-surface px-3 text-sm text-ink"
        >
          <option value="all">All types</option>
          {sourcesPresent.map((s) => (
            <option key={s} value={s}>
              {QUEUE_SOURCE_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={ageFilter}
          onChange={(e) => setAgeFilter(e.target.value as (typeof AGE_FILTERS)[number]["id"])}
          aria-label="Filter by age"
          className="h-9 rounded-control border border-border bg-surface px-3 text-sm text-ink"
        >
          {AGE_FILTERS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          message={view === "resolved" ? "Nothing resolved matches these filters." : "No items need attention here."}
          isHealthy={view !== "resolved"}
        />
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border bg-surface">
          {filtered.map((item) => (
            <li key={item.key} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="text-[10px]">
                    {QUEUE_SOURCE_LABELS[item.source]}
                  </Badge>
                  {item.urgent && (
                    <Badge variant="destructive" className="text-[10px]">
                      Urgent
                    </Badge>
                  )}
                  <span className="truncate font-medium text-ink">{item.title}</span>
                </div>
                {item.subtitle && <p className="mt-0.5 truncate text-sm text-ink-muted">{item.subtitle}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="flex items-center gap-1 text-xs text-ink-muted">
                  <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                  {formatAge(item.ageMinutes)}
                </span>
                <span className="text-xs capitalize text-ink-muted">{item.statusLabel}</span>
                {item.href && (
                  <Link
                    href={item.href}
                    className="flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    Open <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
