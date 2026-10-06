import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ActivityFeed } from "./ActivityFeed";
import type { ActivityItem } from "@/lib/akiba/activity";

export function RecentActivitySection({ items }: { items: ActivityItem[] }) {
  return (
    <section className="mb-4" aria-labelledby="recent-activity-heading">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 id="recent-activity-heading" className="font-sterling text-xl font-semibold text-akiba-ink sm:text-2xl">
            Recent activity
          </h2>
          <p className="mt-0.5 text-xs text-akiba-muted sm:text-sm">Your latest Miles and reward moments.</p>
        </div>
        {items.length > 0 && (
          <Link
            href="/me/activity"
            className="-mb-1 -mr-2 flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-akiba-teal transition hover:bg-akiba-tint hover:text-akiba-tealDark active:bg-akiba-tint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-akiba-teal"
          >
            View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
      <ActivityFeed items={items.slice(0, 3)} />
    </section>
  );
}
