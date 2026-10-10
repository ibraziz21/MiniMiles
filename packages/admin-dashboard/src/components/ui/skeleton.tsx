import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-control bg-surface-subtle motion-reduce:animate-none", className)}
      aria-hidden="true"
    />
  );
}
