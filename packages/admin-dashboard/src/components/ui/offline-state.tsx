import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function OfflineState({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-card border border-warning/30 bg-warning/5 px-4 py-3 text-sm text-ink",
        className,
      )}
      role="status"
    >
      <WifiOff className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
      <span>You&apos;re offline. Live data and actions require a connection.</span>
    </div>
  );
}
