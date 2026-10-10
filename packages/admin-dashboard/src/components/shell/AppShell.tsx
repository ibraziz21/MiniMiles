"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { buildNav, type NavNode } from "@/lib/navigation";
import type { AdminRole } from "@/types";
import { PrimaryRail } from "./PrimaryRail";
import { ContextNav } from "./ContextNav";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileMoreSheet } from "./MobileMoreSheet";
import { CommandSearch } from "./CommandSearch";
import { CommandSearchProvider } from "./search-context";
import { ConnectionStatus } from "./ConnectionStatus";
import { InstallPrompt } from "./InstallPrompt";
import { UpdateAvailableToast } from "./UpdateAvailableToast";

interface AppShellProps {
  children: React.ReactNode;
  adminName: string | null;
  adminRole: AdminRole;
  fundedVouchersEnabled: boolean;
  fundedFinanceEnabled: boolean;
}

function moduleContainsPath(node: NavNode, pathname: string): boolean {
  const ownMatch = node.exact ? pathname === node.targetRoute : pathname.startsWith(node.targetRoute);
  if (ownMatch) return true;
  return node.children?.some((child) => moduleContainsPath(child, pathname)) ?? false;
}

export function AppShell({ children, adminName, adminRole, fundedVouchersEnabled, fundedFinanceEnabled }: AppShellProps) {
  const pathname = usePathname();
  const nav = useMemo(() => buildNav(adminRole, fundedVouchersEnabled, fundedFinanceEnabled), [adminRole, fundedVouchersEnabled, fundedFinanceEnabled]);

  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const activeModule = nav.desktopPrimary.find((module) => moduleContainsPath(module, pathname)) ?? null;
  const contextItems = activeModule?.children ?? [];

  const mainRef = useRef<HTMLElement>(null);
  const isFirstRender = useRef(true);
  useEffect(() => {
    // Route changes move focus to the main landmark without breaking browser
    // history (spec §12) — skipped on first mount so load-time focus isn't
    // stolen from the browser chrome/URL bar.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus();
  }, [pathname]);

  return (
    <CommandSearchProvider open={() => setSearchOpen(true)}>
      <div className="flex min-h-dvh bg-canvas">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
        >
          Skip to main content
        </a>

        <PrimaryRail
          modules={nav.desktopPrimary}
          activeModuleId={activeModule?.id ?? null}
          adminName={adminName}
          adminRole={adminRole}
        />

        {activeModule && <ContextNav moduleLabel={activeModule.label} items={contextItems} />}

        <div className="flex min-w-0 flex-1 flex-col">
          <ConnectionStatus />
          <main
            id="main-content"
            ref={mainRef}
            tabIndex={-1}
            className="min-w-0 flex-1 overflow-y-auto pb-20 outline-none lg:pb-0"
          >
            <div className="mx-auto w-full max-w-[1440px]">{children}</div>
          </main>
        </div>

        <MobileBottomNav ref={moreButtonRef} slots={nav.mobilePrimary} onMoreClick={() => setMoreOpen(true)} />
        <MobileMoreSheet
          open={moreOpen}
          onOpenChange={setMoreOpen}
          destinations={nav.mobileMore}
          adminName={adminName}
          adminRole={adminRole}
          triggerRef={moreButtonRef}
        />
        <CommandSearch open={searchOpen} onOpenChange={setSearchOpen} />
        <InstallPrompt />
        <UpdateAvailableToast />
      </div>
    </CommandSearchProvider>
  );
}
