"use client";

import { Logo } from "@/components/Logo";
import { AKIBA_HUB_APP_URL, PARTNER_WITH_AKIBA_URL } from "@/constants/links";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-akiba-ink">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Logo dark />
        <div className="flex items-center gap-3">
          <a
            href={PARTNER_WITH_AKIBA_URL}
            className="hidden text-sm text-white/50 no-underline transition hover:text-white sm:block"
            target="_blank"
            rel="noopener noreferrer"
          >
            For partners
          </a>
          <a
            href={AKIBA_HUB_APP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center rounded-full bg-akiba-teal px-4 text-sm font-semibold text-white no-underline transition hover:bg-[#1E7E8D]"
          >
            Open App
          </a>
        </div>
      </div>
    </header>
  );
}
