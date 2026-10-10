"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavNode } from "@/lib/navigation";

function ContextLink({ node }: { node: NavNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(() => node.children?.some((c) => pathname.startsWith(c.targetRoute)) ?? false);

  const isActive = node.exact ? pathname === node.targetRoute : pathname.startsWith(node.targetRoute);
  const Icon = node.icon;

  if (node.children && node.children.length > 0) {
    const groupActive = node.children.some((c) => pathname.startsWith(c.targetRoute));
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn(
            "flex min-h-[44px] w-full items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            groupActive ? "bg-primary/10 text-primary-strong" : "text-ink-muted hover:bg-surface-subtle hover:text-ink",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 text-left">{node.label}</span>
          {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
        {open && (
          <div className="ml-5 mt-1 space-y-0.5 border-l border-border pl-2">
            {node.children.map((child) => (
              <ContextLink key={child.id} node={child} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={node.targetRoute}
      aria-current={isActive ? "page" : undefined}
      className={cn(
        "flex min-h-[44px] items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isActive ? "bg-primary/10 text-primary-strong shadow-[inset_3px_0_0_theme(colors.primary.DEFAULT)]" : "text-ink-muted hover:bg-surface-subtle hover:text-ink",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{node.label}</span>
    </Link>
  );
}

interface ContextNavProps {
  moduleLabel: string;
  items: NavNode[];
}

export function ContextNav({ moduleLabel, items }: ContextNavProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label={`${moduleLabel} navigation`}
      className={cn(
        "hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex",
        collapsed ? "w-[64px]" : "w-[252px]",
      )}
    >
      <div className="flex h-14 items-center justify-between px-3">
        {!collapsed && <p className="truncate text-sm font-semibold text-ink">{moduleLabel}</p>}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="ml-auto flex h-8 w-8 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          aria-label={collapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden="true" /> : <ChevronsLeft className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      {!collapsed && (
        <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
          {items.map((item) => (
            <ContextLink key={item.id} node={item} />
          ))}
        </div>
      )}
    </nav>
  );
}
