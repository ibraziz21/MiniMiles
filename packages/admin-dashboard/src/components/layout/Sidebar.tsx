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
  Gamepad2,
  Dice5,
  Claw,
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

const navItems: NavItem[] = [
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
  { href: "/merchants", label: "Merchants", icon: Store },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
  { href: "/vouchers", label: "Vouchers & Rewards", icon: Tag },
  { href: "/finance", label: "Finance", icon: Landmark },
  { href: "/users", label: "Users & Wallets", icon: Users },
  {
    href: "/games",
    label: "Games",
    icon: Gamepad2,
    children: [
      { href: "/games/dice", label: "Dice", icon: Dice5 },
      { href: "/games/claw", label: "Claw", icon: Gamepad2 },
      { href: "/games/raffles", label: "Raffles", icon: Ticket },
    ],
  },
  { href: "/ops-queue", label: "Ops Queue", icon: ListChecks },
  { href: "/audit-log", label: "Audit Log", icon: ScrollText },
  { href: "/team", label: "Admin Team", icon: ShieldCheck },
  { href: "/settings", label: "Settings", icon: Settings },
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
            "group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
            groupActive
              ? "bg-[linear-gradient(135deg,rgba(35,141,157,0.14),rgba(35,141,157,0.06))] text-[#238D9D]"
              : "text-slate-700 hover:bg-white/80 hover:text-slate-900",
          )}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="flex-1 text-left">{item.label}</span>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        {open && (
          <div className="ml-4 mt-0.5 space-y-0.5 border-l border-slate-200 pl-2">
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
        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-[linear-gradient(135deg,rgba(35,141,157,0.14),rgba(35,141,157,0.06))] text-[#238D9D] shadow-[inset_0_0_0_1px_rgba(35,141,157,0.12)]"
          : "text-slate-700 hover:bg-white/80 hover:text-slate-900",
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
    <aside className="flex h-full w-64 flex-col border-r border-white/60 bg-white/70 backdrop-blur-xl">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-black/5 px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white shadow-[0_8px_24px_rgba(35,141,157,0.18)] ring-1 ring-[#238D9D]/10">
          <BrandMark className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">AkibaMiles</p>
          <p className="text-xs uppercase tracking-[0.22em] text-[#238D9D]">Admin</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {navItems.map((item) => (
          <NavLink key={item.href} item={item} />
        ))}
      </nav>

      {/* User + Logout */}
      <div className="border-t border-black/5 p-3 space-y-1">
        <div className="px-3 py-2">
          <p className="text-sm font-medium text-slate-900 truncate">{adminName ?? "Admin"}</p>
          <p className="text-xs text-slate-500 capitalize">{adminRole.replace("_", " ")}</p>
        </div>
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-white/80 hover:text-slate-900"
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
