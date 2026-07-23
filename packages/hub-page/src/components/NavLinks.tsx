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
//   Shop | Quests | [Pass ↑ elevated] | Vouchers | Rewards | Profile
//
// Pass sits in the centre slot with a filled rounded square that floats
// slightly above the bar — it's the product's core gesture (home-redesign-
// spec.md §4), always one tap away regardless of what page you're on.
// Vouchers moves to a regular slot alongside Rewards.

const LEFT_NAV  = [
  { href: "/shop",   label: "Shop",   icon: ShoppingBag },
  { href: "/quests", label: "Quests", icon: Zap },
];
const RIGHT_NAV = [
  { href: "/vouchers", label: "Vouchers", icon: Tag },
  { href: "/rewards",  label: "Rewards",  icon: Sparkles },
];

export function BottomNav() {
  const path = usePathname();
  if (path === "/login") return null;

  const passActive    = path === "/pass" || path.startsWith("/pass/");
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

        {/* ── Centre — Pass (elevated pill) ───────────────────────────────── */}
        <a
          href="/pass"
          onClick={() => track("pass_nav_tap")}
          className="relative flex flex-1 flex-col items-center justify-center gap-1 -mt-5 transition-colors"
        >
          <span
            className={clsx(
              "flex h-12 w-12 items-center justify-center rounded-2xl shadow-md transition-colors active:scale-95",
              passActive ? "bg-akiba-teal" : "bg-akiba-ink"
            )}
          >
            <QrCode className="h-[22px] w-[22px] text-white" />
          </span>
          <span
            className={clsx(
              "text-[10px] font-semibold tracking-wide",
              passActive ? "text-akiba-teal" : "text-akiba-muted"
            )}
          >
            Pass
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
