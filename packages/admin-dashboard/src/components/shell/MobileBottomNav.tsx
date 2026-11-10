"use client";

import { forwardRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { MobilePrimarySlot } from "@/lib/navigation";

interface MobileBottomNavProps {
  slots: MobilePrimarySlot[];
  onMoreClick: () => void;
  /** Real count only — never a fabricated placeholder (spec §5.2). */
  queueCount?: number;
}

export const MobileBottomNav = forwardRef<HTMLButtonElement, MobileBottomNavProps>(function MobileBottomNav(
  { slots, onMoreClick, queueCount },
  moreButtonRef,
) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 flex gap-1 min-[375px]:gap-2 border-t border-border bg-surface px-1 min-[375px]:px-2 pt-2 shadow-[0_-4px_16px_rgba(15,23,42,0.04)] lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {slots.map((slot) => {
        const Icon = slot.icon;
        const isActive = slot.targetRoute !== null && (slot.matchRoutes ?? [slot.targetRoute]).some((route) => pathname === route || pathname.startsWith(`${route}/`));

        if (slot.targetRoute === null) {
          return (
            <button
              key={slot.id}
              ref={moreButtonRef}
              onClick={onMoreClick}
              aria-label="Open more destinations"
              className="flex min-h-[56px] min-w-0 rounded-control flex-1 flex-col items-center justify-center gap-1 px-0 py-1 text-ink-muted hover:bg-surface-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Icon className="h-6 w-6" aria-hidden="true" />
              <span className="w-full truncate text-center text-xs tracking-tight font-medium">{slot.label}</span>
            </button>
          );
        }

        return (
          <Link
            key={slot.id}
            href={slot.targetRoute}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "relative flex min-h-[56px] min-w-0 rounded-control flex-1 flex-col items-center justify-center gap-1 px-0 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
              isActive ? "bg-primary/10 text-primary-strong" : "text-ink-muted hover:bg-surface-subtle",
            )}
          >
            {isActive && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-primary" aria-hidden="true" />}
            <span className="relative">
              <Icon className={cn("h-6 w-6", isActive && "stroke-[2.5]")} aria-hidden="true" />
              {slot.id === "queue" && typeof queueCount === "number" && queueCount > 0 && (
                <span className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold text-white">
                  {queueCount > 99 ? "99+" : queueCount}
                </span>
              )}
            </span>
            <span className={cn("w-full truncate text-center text-xs tracking-tight", isActive ? "font-semibold" : "font-medium")}>
              {slot.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
});
