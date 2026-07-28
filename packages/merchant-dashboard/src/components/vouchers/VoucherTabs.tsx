"use client";

// Sidebar keeps one top-level "Vouchers" item (merchant-ux-spec.md §4 — "New
// top-level sidebar items are not required"); this renders the five views as
// tabs within it.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/vouchers/overview", label: "Overview" },
  { href: "/vouchers", label: "Vouchers" },
  { href: "/vouchers/programs", label: "Distribution" },
  { href: "/vouchers/issued", label: "Issued" },
  { href: "/vouchers/redemptions", label: "Redemptions" },
] as const;

export function VoucherTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b border-gray-100 px-6">
      {TABS.map(({ href, label }) => {
        const active = href === "/vouchers" ? pathname === "/vouchers" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
              active
                ? "border-[#238D9D] text-[#238D9D]"
                : "border-transparent text-gray-500 hover:text-gray-800"
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
