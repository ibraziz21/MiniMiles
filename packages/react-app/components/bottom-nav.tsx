"use client";

import { Home, Wallet, Activity, Gamepad2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const BottomNav = () => {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  };

  const navItems = [
    {
      href: "/earn",
      label: "Earn",
      icon: Activity,
      active: isActive("/earn"),
    },
    {
      href: "/",
      label: "Home",
      icon: Home,
      active: isActive("/"),
    },
    {
      href: "/spend",
      label: "Spend",
      icon: Wallet,
      active: isActive("/spend"),
    },
    {
      href: "/games",
      label: "Games",
      icon: Gamepad2,
      active: isActive("/games") || isActive("/dice") || isActive("/claw") || isActive("/crackpot"),
    },
  ];

  return (
    <nav className="fixed bottom-0 w-full bg-white border-t border-[#E8F5F0] px-2 py-2 flex justify-around items-center shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
      {navItems.map(({ href, label, icon: Icon, active }) => (
        <Link
          key={href}
          href={href}
          className={`flex flex-col items-center gap-0.5 text-xs transition-colors flex-1 py-1 ${
            active ? "text-[#238D9D]" : "text-[#A0A0A0]"
          }`}
        >
          <Icon className={`h-5 w-5 transition-colors ${active ? "stroke-[#238D9D]" : ""}`} />
          <span className={`font-medium ${active ? "font-bold" : ""}`}>{label}</span>
          {active && <span className="h-1 w-1 rounded-full bg-[#238D9D]" />}
        </Link>
      ))}
    </nav>
  );
};
