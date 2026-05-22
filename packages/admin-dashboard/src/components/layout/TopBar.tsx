"use client";

import { Search } from "lucide-react";

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-[72px] items-center justify-between border-b border-slate-200 bg-white px-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-950">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden h-9 w-64 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-400 lg:flex">
          <Search className="h-4 w-4" />
          <span>Search admin data</span>
        </div>
        {actions}
      </div>
    </header>
  );
}
