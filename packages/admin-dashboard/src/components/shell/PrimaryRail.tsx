"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, User } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavNode } from "@/lib/navigation";
import { BrandMark } from "@/components/layout/BrandMark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PrimaryRailProps {
  modules: NavNode[];
  activeModuleId: string | null;
  adminName: string | null;
  adminRole: string;
}

export function PrimaryRail({ modules, activeModuleId, adminName, adminRole }: PrimaryRailProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <nav
      aria-label="Primary"
      className="hidden w-[88px] shrink-0 flex-col items-center border-r border-border bg-surface py-3 lg:flex"
    >
      <Link href="/overview" aria-label="AkibaMiles admin home" className="mb-4 flex h-11 w-11 items-center justify-center rounded-card bg-surface-subtle ring-1 ring-border">
        <BrandMark className="h-7 w-7" />
      </Link>

      <ul className="flex w-full flex-1 flex-col items-center gap-1">
        {modules.map((module) => {
          const Icon = module.icon;
          const isActive = module.id === activeModuleId || pathname.startsWith(module.targetRoute);
          return (
            <li key={module.id} className="w-full px-2">
              <Link
                href={module.targetRoute}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex min-h-[44px] w-full flex-col items-center justify-center gap-1 rounded-card px-1 py-2 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  isActive ? "bg-primary/10 text-primary" : "text-ink-muted hover:bg-surface-subtle hover:text-ink",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                <span className="w-full truncate text-center leading-none">{module.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-subtle text-ink-muted ring-1 ring-border transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            aria-label="Account menu"
          >
            <User className="h-5 w-5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end">
          <DropdownMenuLabel>
            <p className="truncate text-sm font-medium text-ink">{adminName ?? "Admin"}</p>
            <p className="truncate text-xs capitalize text-ink-muted">{adminRole.replace(/_/g, " ")}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={handleLogout}>
            <LogOut className="h-4 w-4" aria-hidden="true" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}
