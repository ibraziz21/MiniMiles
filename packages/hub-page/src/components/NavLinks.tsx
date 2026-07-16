"use client";

import { usePathname } from "next/navigation";
import { ShoppingBag, Sparkles, Zap, Tag, User } from "lucide-react";
import clsx from "clsx";

const LINKS = [
  { href: "/shop",     label: "Shop & Earn", icon: ShoppingBag },
  { href: "/vouchers", label: "Vouchers",    icon: Tag },
  { href: "/rewards",  label: "Rewards",     icon: Sparkles },
  { href: "/quests",   label: "Quests",      icon: Zap },
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

// Bottom nav item order (mobile):
//   Shop | Quests | [Vouchers ↑ elevated] | Rewards | Profile
//
// Vouchers sits in the centre slot with a filled rounded square that floats
// slightly above the bar — it's the highest-value action on Hub (spending miles).

const LEFT_NAV  = [
  { href: "/shop",   label: "Shop",   icon: ShoppingBag },
  { href: "/quests", label: "Quests", icon: Zap },
];
const RIGHT_NAV = [
  { href: "/rewards", label: "Rewards", icon: Sparkles },
];

export function BottomNav() {
  const path = usePathname();
  if (path === "/login") return null;

  const vouchersActive = path === "/vouchers" || path.startsWith("/vouchers/");
  const profileActive  = path === "/me" || path.startsWith("/me/");

  return (
    <nav
      className={clsx(
        "fixed inset-x-0 bottom-0 z-50 sm:hidden",
        // overflow-visible so the elevated centre button can float above the border
        "overflow-visible border-t border-akiba-line bg-white/95 backdrop-blur-sm",
        // reserve the home-indicator area on installed/standalone PWAs
        "pb-[env(safe-area-inset-bottom)]"
      )}
    >
      <div className="flex h-16">

        {/* ── Left items ──────────────────────────────────────────────────── */}
        {LEFT_NAV.map(({ href, label, icon: Icon }) => {
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

        {/* ── Centre — Vouchers (elevated pill) ───────────────────────────── */}
        <a
          href="/vouchers"
          className="relative flex flex-1 flex-col items-center justify-center gap-1 -mt-5 transition-colors"
        >
          <span
            className={clsx(
              "flex h-12 w-12 items-center justify-center rounded-2xl shadow-md transition-colors active:scale-95",
              vouchersActive ? "bg-akiba-teal" : "bg-akiba-ink"
            )}
          >
            <Tag className="h-[22px] w-[22px] text-white" />
          </span>
          <span
            className={clsx(
              "text-[10px] font-semibold tracking-wide",
              vouchersActive ? "text-akiba-teal" : "text-akiba-muted"
            )}
          >
            Vouchers
          </span>
        </a>

        {/* ── Right items ──────────────────────────────────────────────────── */}
        {RIGHT_NAV.map(({ href, label, icon: Icon }) => {
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

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <a
          href="/me"
          className={clsx(
            "flex flex-1 flex-col items-center justify-center gap-1 transition-colors",
            profileActive ? "text-akiba-teal" : "text-akiba-muted"
          )}
        >
          <span
            className={clsx(
              "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
              profileActive
                ? "bg-akiba-teal/15 text-akiba-teal"
                : "bg-akiba-muted/10 text-akiba-muted"
            )}
          >
            <User className="h-3.5 w-3.5" />
          </span>
          <span className="text-[10px] font-semibold tracking-wide">Profile</span>
        </a>

      </div>
    </nav>
  );
}
