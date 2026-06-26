"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  BarChart2,
  ClipboardList,
  Store,
  ShoppingBag,
  Tag,
  Landmark,
  Users,
  Inbox,
  Gamepad2,
  Dice5,
  Ticket,
  ListChecks,
  ScrollText,
  ShieldCheck,
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { BrandMark } from "./BrandMark";
import { useState } from "react";

interface SidebarProps {
  adminName: string | null;
  adminRole: string;
}

interface NavItem {
  href: string;
  label: string;
  icon: React.ElementType;
  children?: NavItem[];
}

const navSections: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Command",
    items: [
      { href: "/overview", label: "Overview", icon: LayoutDashboard },
      {
        href: "/insights",
        label: "Insights",
        icon: BarChart2,
        children: [
          { href: "/insights/polls", label: "Polls", icon: ClipboardList },
          { href: "/insights/verified", label: "Verified Reports", icon: ShieldCheck },
        ],
      },
      { href: "/ops-queue", label: "Ops Queue", icon: ListChecks },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/merchants", label: "Merchants", icon: Store },
      { href: "/leads", label: "Leads", icon: Inbox },
      { href: "/orders", label: "Orders", icon: ShoppingBag },
      { href: "/vouchers", label: "Vouchers", icon: Tag },
      { href: "/finance", label: "Finance", icon: Landmark },
      { href: "/settlement", label: "Settlement", icon: Landmark },
      { href: "/users", label: "Users & Wallets", icon: Users },
      {
        href: "/games",
        label: "Games",
        icon: Gamepad2,
        children: [
          { href: "/games/dice", label: "Dice", icon: Dice5 },
          { href: "/games/claw", label: "Claw", icon: Gamepad2 },
          { href: "/games/skill-games", label: "Skill Games", icon: ListChecks },
          { href: "/games/raffles", label: "Raffles", icon: Ticket },
        ],
      },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/audit-log", label: "Audit Log", icon: ScrollText },
      { href: "/team", label: "Admin Team", icon: ShieldCheck },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

function NavLink({ item, depth = 0 }: { item: NavItem; depth?: number }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(() =>
    item.children?.some((c) => pathname.startsWith(c.href)) ?? false,
  );

  const active = pathname === item.href || (!item.children && pathname.startsWith(item.href + "/"));
  const Icon = item.icon;

  if (item.children) {
    const groupActive = item.children.some((c) => pathname.startsWith(c.href));
    return (
      <div>
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "group flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
            groupActive
              ? "bg-[#238D9D]/10 text-[#176B78]"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {open && (
          <div className="ml-5 mt-1 space-y-0.5 border-l border-slate-200 pl-2">
            {item.children.map((child) => (
              <NavLink key={child.href} item={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Link
      href={item.href}
      className={cn(
        "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-[#238D9D]/10 text-[#176B78] shadow-[inset_3px_0_0_#238D9D]"
          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{item.label}</span>
    </Link>
  );
}

export function Sidebar({ adminName, adminRole }: SidebarProps) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-[280px] flex-col border-r border-slate-200 bg-white">
      {/* Brand */}
      <div className="flex h-[72px] items-center gap-3 border-b border-slate-200 px-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-50 ring-1 ring-slate-200">
          <BrandMark className="h-8 w-8" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">MiniMiles</p>
          <p className="text-xs font-medium text-slate-500">Admin Console</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {navSections.map((section) => (
          <div key={section.label} className="mb-5 last:mb-0">
            <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-slate-200 p-3">
        <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
          <p className="text-sm font-medium text-slate-900 truncate">{adminName ?? "Admin"}</p>
          <p className="text-xs text-slate-500 capitalize">{adminRole.replace("_", " ")}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
