"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, ShoppingBag, Package, Tag, BarChart2, Users, Settings, LogOut } from "lucide-react";
import { BrandMark } from "./BrandMark";

interface SidebarProps {
  partnerName: string;
  newOrdersCount?: number;
}

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "Orders", icon: ShoppingBag },
  { href: "/products", label: "Products", icon: Package },
  { href: "/vouchers", label: "Vouchers", icon: Tag },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar({ partnerName, newOrdersCount = 0 }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-64 flex-col border-r border-white/60 bg-white/70 backdrop-blur-xl">
      {/* Brand */}
      <div className="flex h-20 items-center gap-3 border-b border-black/5 px-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white shadow-[0_16px_32px_rgba(35,141,157,0.18)] ring-1 ring-[#238D9D]/10">
          <BrandMark className="h-7 w-7" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{partnerName}</p>
          <p className="text-xs uppercase tracking-[0.22em] text-[#238D9D]">AkibaMiles Merchant</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                active
                  ? "bg-[linear-gradient(135deg,rgba(35,141,157,0.14),rgba(35,141,157,0.06))] text-[#238D9D] shadow-[inset_0_0_0_1px_rgba(35,141,157,0.12)]"
                  : "text-slate-700 hover:bg-white/80 hover:text-slate-900",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{label}</span>
              {label === "Orders" && newOrdersCount > 0 && (
                <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#238D9D] px-1.5 text-xs font-semibold text-white">
                  {newOrdersCount > 99 ? "99+" : newOrdersCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="border-t border-black/5 p-3">
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
