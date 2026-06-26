"use client";

import { usePathname } from "next/navigation";
import { ShoppingBag, Sparkles, Zap, Tag } from "lucide-react";
import clsx from "clsx";

const LINKS = [
  { href: "/shop", label: "Shop & Earn", icon: ShoppingBag },
  { href: "/vouchers", label: "Vouchers", icon: Tag },
  { href: "/rewards", label: "Rewards", icon: Sparkles },
  { href: "/quests", label: "Quests", icon: Zap },
];

export function NavLinks({ dark = false }: { dark?: boolean }) {
  const path = usePathname();

  return (
    <>
      {LINKS.map(({ href, label }) => {
        const active = path === href || path.startsWith(href + "/");
        return (
          <a
            key={href}
            href={href}
            className={clsx(
              "relative px-1 py-0.5 text-sm font-medium transition-colors",
              dark
                ? active
                  ? "text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-[2px] after:rounded-full after:bg-akiba-teal after:content-['']"
                  : "text-white/50 hover:text-white"
                : active
                ? "text-akiba-teal after:absolute after:inset-x-0 after:-bottom-0.5 after:h-[2px] after:rounded-full after:bg-akiba-teal after:content-['']"
                : "text-akiba-muted hover:text-akiba-ink"
            )}
          >
            {label}
          </a>
        );
      })}
    </>
  );
}

export function BottomNav() {
  const path = usePathname();
  if (path === "/login") return null;

  return (
    <nav className="fixed bottom-0 inset-x-0 z-50 border-t border-akiba-line bg-white/95 backdrop-blur-sm sm:hidden">
      <div className="flex h-16">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = path === href || path.startsWith(href + "/");
          return (
            <a
              key={href}
              href={href}
              className={clsx(
                "flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
                active ? "text-akiba-teal" : "text-akiba-muted"
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-semibold tracking-wide">{label}</span>
            </a>
          );
        })}
        <a
          href="/me"
          className={clsx(
            "flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
            path.startsWith("/me") ? "text-akiba-teal" : "text-akiba-muted"
          )}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-current/10 text-[10px] font-bold text-inherit">
            Me
          </span>
          <span className="text-[10px] font-semibold tracking-wide">Profile</span>
        </a>
      </div>
    </nav>
  );
}
