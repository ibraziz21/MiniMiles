"use client";

import { Search } from "lucide-react";
import { useCommandSearchTrigger } from "@/components/shell/search-context";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

/**
 * Not yet mounted by AppShell in Phase 1 — every existing page still renders
 * its own TopBar (src/components/layout/TopBar.tsx), which already carries
 * each page's h1. Mounting this globally too would double every page's
 * heading. This component is the intended replacement once a page migrates
 * in Phase 2+ (at which point its TopBar usage is removed), kept ready now.
 */
export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const onOpenSearch = useCommandSearchTrigger();

  return (
    <header className="sticky top-0 z-30 flex min-h-[56px] items-center gap-3 border-b border-border bg-surface px-4 py-2 sm:min-h-[64px] sm:px-6">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-semibold text-ink sm:text-xl">{title}</h1>
        {subtitle && <p className="truncate text-sm text-ink-muted">{subtitle}</p>}
      </div>

      <button
        onClick={onOpenSearch}
        className="flex h-11 w-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        aria-label="Search"
      >
        <Search className="h-5 w-5" aria-hidden="true" />
      </button>

      <button
        onClick={onOpenSearch}
        className="hidden min-h-[36px] items-center gap-2 rounded-control border border-border bg-canvas px-3 text-sm text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:flex"
      >
        <Search className="h-4 w-4" aria-hidden="true" />
        <span>Search</span>
        <kbd className="ml-2 rounded border border-border bg-surface px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
          ⌘K
        </kbd>
      </button>

      {actions}
    </header>
  );
}
