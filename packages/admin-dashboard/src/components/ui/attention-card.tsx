import Link from "next/link";
import { CheckCircle2, ChevronRight, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export interface AttentionItem {
  id: string;
  label: string;
  href: string;
  count: number;
  /** Minutes since the oldest pending item in this source, if known. */
  oldestAgeMinutes?: number | null;
}

function formatAge(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

interface AttentionCardProps {
  items: AttentionItem[];
  className?: string;
}

/** The one urgent-work surface spec §10.1/§10.2 asks every role to see before anything else — real counts only, never fabricated. */
export function AttentionCard({ items, className }: AttentionCardProps) {
  const withWork = items.filter((item) => item.count > 0);

  if (withWork.length === 0) {
    return (
      <Card className={cn("flex items-center gap-3 border-success/25 bg-success/[0.04] p-4 shadow-none", className)}>
        <CheckCircle2 className="h-5 w-5 shrink-0 text-success" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">Nothing needs attention right now.</p>
      </Card>
    );
  }

  return (
    <Card className={cn("overflow-hidden border-border bg-surface p-0 shadow-[0_16px_45px_-32px_rgba(15,23,42,0.45)]", className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-control bg-warning/10 text-warning">
            <ListChecks className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-ink">Key action items</h2>
            <p className="text-xs text-ink-muted">Prioritized by age across your queues</p>
          </div>
        </div>
        <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold tabular-nums text-warning">
          {withWork.reduce((sum, item) => sum + item.count, 0)} open
        </span>
      </div>
      <div className="divide-y divide-border">
        {withWork.map((item) => (
          <Link
            key={item.id}
            href={item.href}
            className="group flex min-h-[52px] items-center justify-between gap-3 px-4 py-3 transition-colors duration-200 hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary sm:px-5"
          >
            <span className="flex min-w-0 items-center gap-3 text-sm font-medium text-ink">
              <span className="flex h-7 min-w-7 items-center justify-center rounded-full bg-warning/10 px-2 text-xs font-bold tabular-nums text-warning">{item.count}</span>
              <span className="truncate">{item.label}</span>
            </span>
            <span className="flex items-center gap-1 text-xs text-ink-muted">
              {typeof item.oldestAgeMinutes === "number" && `oldest ${formatAge(item.oldestAgeMinutes)}`}
              <ChevronRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>
        ))}
      </div>
    </Card>
  );
}
