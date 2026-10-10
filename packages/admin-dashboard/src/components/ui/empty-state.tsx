import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  message: string;
  /** Whether an empty result is the healthy/expected outcome (e.g. "No payments need review.") vs. an absence worth flagging. */
  isHealthy?: boolean;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, message, isHealthy = true, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-card border border-dashed border-border bg-surface px-6 py-10 text-center",
        className,
      )}
      role="status"
    >
      {Icon && (
        <Icon
          className={cn("h-8 w-8", isHealthy ? "text-success" : "text-ink-muted")}
          aria-hidden="true"
        />
      )}
      <p className="text-sm text-ink-muted">{message}</p>
      {action}
    </div>
  );
}
