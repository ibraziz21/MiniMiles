"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import type { NavNode } from "@/lib/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";

interface MobileMoreSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: NavNode[];
  adminName: string | null;
  adminRole: string;
  /** The bottom-nav "More" button — opened via external state rather than a Radix Trigger, so focus restoration on close is wired explicitly here instead of relying on Radix's default trigger-tracking. */
  triggerRef: React.RefObject<HTMLButtonElement>;
}

export function MobileMoreSheet({ open, onOpenChange, destinations, adminName, adminRole, triggerRef }: MobileMoreSheetProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title="More"
        description="Additional admin destinations and account actions"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          triggerRef.current?.focus();
        }}
      >
        <div className="border-b border-border px-4 py-3">
          <p className="truncate text-sm font-medium text-ink">{adminName ?? "Admin"}</p>
          <p className="truncate text-xs capitalize text-ink-muted">{adminRole.replace(/_/g, " ")}</p>
        </div>
        <ul className="divide-y divide-border">
          {destinations.map((node) => (
            <li key={node.id}>
              <MoreDestination node={node} onNavigate={() => onOpenChange(false)} />
            </li>
          ))}
        </ul>
        <button
          onClick={handleLogout}
          className="flex min-h-[44px] w-full items-center gap-3 border-t border-border px-4 py-3 text-sm font-medium text-ink-muted transition-colors hover:bg-surface-subtle hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <LogOut className="h-5 w-5 shrink-0" aria-hidden="true" />
          Sign out
        </button>
      </SheetContent>
    </Sheet>
  );
}

function MoreDestination({ node, onNavigate }: { node: NavNode; onNavigate: () => void }) {
  const Icon = node.icon;
  const style = "flex min-h-12 w-full items-center gap-3 px-4 py-3 text-sm font-medium text-ink transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";
  if (node.children?.length) {
    return <details>
      <summary className={`${style} cursor-pointer`}><Icon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" /><span>{node.label}</span><span className="ml-auto text-xs text-ink-muted">Expand</span></summary>
      <ul className="ml-5 border-l border-border">{node.children.map(child => <li key={child.id}><MoreDestination node={child} onNavigate={onNavigate} /></li>)}</ul>
    </details>;
  }
  return <Link href={node.targetRoute} onClick={onNavigate} className={style}><Icon className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />{node.label}</Link>;
}
