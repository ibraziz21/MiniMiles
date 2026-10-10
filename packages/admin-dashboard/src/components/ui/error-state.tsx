import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  /** What failed — spec §13.3 part 1. */
  whatFailed: string;
  /** Whether previously-shown data may now be stale — spec §13.3 part 2. */
  mayBeStale?: boolean;
  /** What the user can do next — spec §13.3 part 3. */
  nextAction: React.ReactNode;
  className?: string;
}

export function ErrorState({ whatFailed, mayBeStale, nextAction, className }: ErrorStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-card border border-danger/30 bg-danger/5 px-4 py-4",
        className,
      )}
      role="alert"
    >
      <div className="flex items-center gap-2 text-sm font-medium text-danger">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {whatFailed}
      </div>
      {mayBeStale && <p className="text-xs text-ink-muted">The data shown may be out of date.</p>}
      <div className="text-sm text-ink">{nextAction}</div>
    </div>
  );
}
