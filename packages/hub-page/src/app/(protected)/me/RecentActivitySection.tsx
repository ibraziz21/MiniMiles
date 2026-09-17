"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown } from "lucide-react";
import clsx from "clsx";
import { ActivityFeed } from "./ActivityFeed";
import type { ActivityItem } from "@/lib/akiba/activity";

const COLLAPSED_COUNT = 2;
const EXPANDED_COUNT = 5;

/**
 * Collapsed by default (2 items) — the full 5-item feed plus heading was
 * pushing more relevant profile content (identity, settings) too far down
 * /me. A chevron in the header expands to the full preview; "View all"
 * (when there's more history than fits here) links to /me/activity either
 * way, since that's a separate concern from this in-page preview size.
 */
export function RecentActivitySection({ items }: { items: ActivityItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = items.slice(0, expanded ? EXPANDED_COUNT : COLLAPSED_COUNT);
  const canToggle = items.length > COLLAPSED_COUNT;

  return (
    <div className="mb-4 sm:mb-6">
      <div className="mb-2.5 flex items-center justify-between gap-3 sm:mb-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-akiba-muted">
          Recent activity
        </h2>
        <div className="flex items-center gap-3">
          {items.length >= 6 && (
            <a
              href="/me/activity"
              className="flex items-center gap-1 text-xs font-semibold text-akiba-teal"
            >
              View all <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          )}
          {canToggle && (
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              aria-expanded={expanded}
              aria-label={expanded ? "Show fewer activity items" : "Show more activity items"}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-akiba-line text-akiba-muted transition hover:border-akiba-teal/40 hover:text-akiba-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
            >
              <ChevronDown
                className={clsx("h-4 w-4 transition-transform motion-reduce:transition-none", expanded && "rotate-180")}
                aria-hidden="true"
              />
            </button>
          )}
        </div>
      </div>
      <ActivityFeed items={visible} />
    </div>
  );
}
