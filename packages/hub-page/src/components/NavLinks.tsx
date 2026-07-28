"use client";

import { usePathname } from "next/navigation";
import { ShoppingBag, Sparkles, Zap, Tag, User, QrCode } from "lucide-react";
import clsx from "clsx";
import { track } from "@/lib/analytics/track";

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

      {/* Pass — visually distinct pill, the product's core gesture is always
          one tap away (home-redesign-spec.md §4). */}
      <a
        href="/pass"
        onClick={() => track("pass_nav_tap")}
        className={clsx(
          "flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold transition-colors",
          path === "/pass" || path.startsWith("/pass/")
            ? "bg-akiba-teal text-white"
            : dark
            ? "bg-white/10 text-white hover:bg-white/20"
            : "bg-akiba-tint text-akiba-teal hover:bg-akiba-teal/15"
        )}
      >
        <QrCode className="h-4 w-4" />
        Pass
      </a>
    </>
  );
}

// Bottom nav item order (mobile):
//   Shop | Quests | Vouchers | Rewards | Profile
//
// Pass is no longer a bar slot — five evenly-spaced items was already tight,
// and Pass is the product's core gesture (home-redesign-spec.md §4), so it
// gets its own floating action button instead, always one tap away without
// competing for bar space.

const NAV_ITEMS = [
  { href: "/shop",     label: "Shop",     icon: ShoppingBag },
  { href: "/quests",   label: "Quests",   icon: Zap },
  { href: "/vouchers", label: "Vouchers", icon: Tag },
  { href: "/rewards",  label: "Rewards",  icon: Sparkles },
];

export function BottomNav() {
  const path = usePathname();
  if (path === "/login") return null;

  const profileActive = path === "/me" || path.startsWith("/me/");

  return (
    <nav
      className={clsx(
        "fixed inset-x-0 bottom-0 z-50 sm:hidden",
        "border-t border-akiba-line bg-white/95 backdrop-blur-sm",
        // reserve the home-indicator area on installed/standalone PWAs
        "pb-[env(safe-area-inset-bottom)]"
      )}
    >
      <div className="flex h-16">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
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

// Pass FAB — floats above the bottom nav bar so it stays a one-tap gesture
// without taking a slot in the (already full) bar. Mobile-only, matching
// BottomNav's breakpoint.
export function PassFab() {
  const path = usePathname();
  if (path === "/login") return null;

  const passActive = path === "/pass" || path.startsWith("/pass/");

  return (
    <a
      href="/pass"
      onClick={() => track("pass_nav_tap")}
      className={clsx(
        "fixed right-4 z-50 flex h-14 w-14 items-center justify-center rounded-2xl shadow-lg transition-colors active:scale-95 sm:hidden",
        "bottom-[calc(4.5rem+env(safe-area-inset-bottom))]",
        passActive ? "bg-akiba-teal" : "bg-akiba-ink"
      )}
    >
      <QrCode className="h-6 w-6 text-white" />
    </a>
  );
}
