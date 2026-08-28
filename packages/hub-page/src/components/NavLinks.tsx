"use client";

import { usePathname } from "next/navigation";
import { Compass, ShoppingBag, Sparkles, Tag, User, QrCode } from "lucide-react";
import clsx from "clsx";
import { track } from "@/lib/analytics/track";

// Primary navigation — akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §3.
// Explore · Merchants · Rewards · Earn · Me, with Pass as a distinct one-tap
// action on both surfaces. Games, quests and referrals no longer occupy
// primary-nav slots; they live inside /earn (§5).
type PrimaryKey = "explore" | "merchants" | "rewards" | "earn" | "me";

const PRIMARY_ITEMS: Array<{ key: PrimaryKey; href: string; label: string; icon: typeof Compass }> = [
  { key: "explore",   href: "/",         label: "Explore",   icon: Compass },
  { key: "merchants", href: "/merchants", label: "Merchants", icon: ShoppingBag },
  { key: "rewards",   href: "/vouchers",  label: "Rewards",   icon: Tag },
  { key: "earn",      href: "/earn",      label: "Earn",      icon: Sparkles },
];

// §3.4 — explicit route-family map. Deliberately not `pathname.startsWith(href)`:
// e.g. "/me" must not fall out of "/merchants" and "/pass" must mark no
// primary item active (Pass is a distinct action, not a nav destination).
export function resolveActivePrimary(pathname: string): PrimaryKey | null {
  if (pathname === "/") return "explore";
  if (pathname === "/merchants" || pathname.startsWith("/merchants/")) return "merchants";
  if (pathname === "/shop" || pathname.startsWith("/shop/")) return "merchants";
  if (pathname === "/vouchers" || pathname.startsWith("/vouchers/")) return "rewards";
  if (pathname === "/my-vouchers") return "rewards";
  if (pathname === "/earn") return "earn";
  if (pathname === "/quests" || pathname.startsWith("/quests/")) return "earn";
  if (pathname === "/games" || pathname.startsWith("/games/")) return "earn";
  if (pathname === "/referrals") return "earn";
  if (pathname === "/me" || pathname.startsWith("/me/")) return "me";
  return null; // includes /pass — Pass only, no primary item is also marked active
}

export function NavLinks({ dark = false }: { dark?: boolean }) {
  const path = usePathname();
  const activeKey = resolveActivePrimary(path);

  return (
    <>
      {PRIMARY_ITEMS.map(({ key, href, label }) => {
        const active = activeKey === key;
        return (
          <a
            key={key}
            href={href}
            onClick={() => track("primary_nav_tap", { destination: key, surface: "desktop" })}
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

// Mobile bottom nav — Explore | Merchants | Rewards | Earn | Me
// (akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §3.3).
// Pass is not a bar slot — it floats above the bar as its own one-tap
// gesture (PassFab below) so it never competes for bar space or obscures
// the Earn/Me tap targets.
const BOTTOM_NAV_ITEMS: Array<{ key: PrimaryKey; href: string; label: string; icon: typeof Compass }> = [
  ...PRIMARY_ITEMS,
  { key: "me", href: "/me", label: "Me", icon: User },
];

export function BottomNav() {
  const path = usePathname();
  if (path === "/login") return null;
  const activeKey = resolveActivePrimary(path);

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
        {BOTTOM_NAV_ITEMS.map(({ key, href, label, icon: Icon }) => {
          const active = activeKey === key;
          return (
            <a
              key={key}
              href={href}
              onClick={() => track("primary_nav_tap", { destination: key, surface: "mobile" })}
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
      </div>
    </nav>
  );
}

// Pass FAB — floats above the bottom nav bar so it stays a one-tap gesture
// without taking a slot in the bar. Mobile-only, matching BottomNav's
// breakpoint. Positioned clear of the Earn/Me tap targets (§3.3).
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
