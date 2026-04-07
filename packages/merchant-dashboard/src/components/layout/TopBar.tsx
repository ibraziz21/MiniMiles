"use client";

import { BrandMark } from "./BrandMark";

interface TopBarProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  return (
    <div className="flex h-20 items-center justify-between border-b border-white/60 bg-white/70 px-6 backdrop-blur-xl">
      <div className="flex items-center gap-4">
        <div className="hidden h-11 w-11 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#ffffff,rgba(255,255,255,0.82))] shadow-[0_18px_36px_rgba(35,141,157,0.16)] ring-1 ring-[#238D9D]/10 md:flex">
          <BrandMark className="h-7 w-7" />
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-[#238D9D]">AkibaMiles</p>
          <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-3">{actions}</div>}
    </div>
  );
}
