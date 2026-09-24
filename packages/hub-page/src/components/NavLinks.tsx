"use client";

import { usePathname } from "next/navigation";
import { Compass, ShoppingBag, Tag, QrCode } from "lucide-react";
import clsx from "clsx";
import { EarnIcon } from "@/components/MilesIcon";
import { track } from "@/lib/analytics/track";

// Primary navigation — akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §3.
// Explore · Merchants · Rewards · Earn, with Pass as a distinct one-tap
// action on both surfaces. Games, quests and referrals no longer occupy
// primary-nav slots; they live inside /earn (§5). Profile ("Me") is
// intentionally not a nav-bar slot on either surface — it's reached from
// the header (SiteHeader's account pill, both breakpoints), so it isn't
// duplicated in the bottom bar too.
type PrimaryKey = "explore" | "merchants" | "rewards" | "earn" | "me";

type PrimaryIcon = React.ComponentType<{
  className?: string;
  "aria-hidden"?: boolean | "true" | "false";
}>;

const PRIMARY_ITEMS: Array<{ key: PrimaryKey; href: string; label: string; icon: PrimaryIcon }> = [
  { key: "explore",   href: "/",         label: "Explore",   icon: Compass },
  { key: "merchants", href: "/merchants", label: "Merchants", icon: ShoppingBag },
  { key: "rewards",   href: "/vouchers",  label: "Rewards",   icon: Tag },
  { key: "earn",      href: "/earn",      label: "Earn",      icon: EarnIcon },
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

// Mobile bottom nav — Explore | Merchants | [Pass] | Rewards | Earn
// (akiba-pass-navigation-rewards-earned-notifications-v1-spec.md §3.3,
// revised). Pass sits in its own elevated center slot — larger than the
// other four icons and popped above the bar, the way a scan/camera action
// sits in many bottom bars — rather than floating separately as its own FAB
// off to the side. Profile lives only in the header now, so the bar holds
// exactly the four PRIMARY_ITEMS split evenly around Pass.
function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: PrimaryIcon;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <a
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 transition-colors active:bg-akiba-card/70",
        active ? "text-akiba-teal" : "text-akiba-muted"
      )}
    >
      <span className={clsx("flex h-8 min-w-10 items-center justify-center rounded-xl transition-colors", active && "bg-akiba-tint") }>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-[10px] font-semibold tracking-wide">{label}</span>
    </a>
  );
}

export function BottomNav() {
  const path = usePathname();
  if (path === "/login") return null;
  const activeKey = resolveActivePrimary(path);
  const passActive = path === "/pass" || path.startsWith("/pass/");

  const [left, right] = [PRIMARY_ITEMS.slice(0, 2), PRIMARY_ITEMS.slice(2)];

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
        {left.map(({ key, href, label, icon }) => (
          <NavItem
            key={key}
            href={href}
            label={label}
            icon={icon}
            active={activeKey === key}
            onNavigate={() => track("primary_nav_tap", { destination: key, surface: "mobile" })}
          />
        ))}

        {/* Pass — elevated, larger center action; pops above the bar rather
            than taking a same-size slot, since it's the product's core
            one-tap gesture. */}
        <div className="flex w-20 flex-none flex-col items-center justify-end pb-1.5">
          <a
            href="/pass"
            onClick={() => track("pass_nav_tap")}
            aria-label="Show your Akiba Pass"
            className={clsx(
              "-mt-8 flex h-14 w-14 items-center justify-center rounded-full shadow-lg ring-4 ring-white transition-transform active:scale-95",
              passActive ? "bg-akiba-teal" : "bg-akiba-ink"
            )}
          >
            <QrCode className="h-6 w-6 text-white" aria-hidden="true" />
          </a>
          <span className={clsx("mt-1 text-[10px] font-semibold tracking-wide", passActive ? "text-akiba-teal" : "text-akiba-muted")}>
            Pass
          </span>
        </div>

        {right.map(({ key, href, label, icon }) => (
          <NavItem
            key={key}
            href={href}
            label={label}
            icon={icon}
            active={activeKey === key}
            onNavigate={() => track("primary_nav_tap", { destination: key, surface: "mobile" })}
          />
        ))}
      </div>
    </nav>
  );
}
