"use client";

import { Search } from "lucide-react";
import { useCommandSearchTrigger } from "@/components/shell/search-context";

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  const openSearch = useCommandSearchTrigger();

  return (
    <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-slate-200 bg-white px-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-950">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button
          onClick={openSearch}
          className="hidden h-9 w-64 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 transition-colors hover:border-primary/40 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:flex"
        >
          <Search className="h-4 w-4" />
          <span>Search admin data</span>
          <kbd className="ml-auto rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-400">
            ⌘K
          </kbd>
        </button>
        <button
          onClick={openSearch}
          aria-label="Search"
          className="flex h-11 w-11 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary lg:hidden"
        >
          <Search className="h-5 w-5" />
        </button>
        {actions}
      </div>
    </header>
  );
}
