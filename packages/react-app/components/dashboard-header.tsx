// src/components/dashboard-header.tsx
import { GearSvg } from "@/lib/svg";
import { Package, Question } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";

export default function DashboardHeader({
  name,
  onOpenOrders,
}: {
  name: any;
  onOpenOrders?: () => void;
}) {
  const initials = name && typeof name === 'string' && name.trim()
    ? name.trim().split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  return (
    <div className="px-4 pt-4 flex justify-between items-center">
      {/* Left: avatar + greeting */}
      <div className="flex items-center gap-2">
        <Link href="/profile" aria-label="View profile">
          <div className="w-9 h-9 rounded-full bg-[#238D9D] flex items-center justify-center flex-shrink-0">
            <span className="text-white text-sm font-bold">{initials}</span>
          </div>
        </Link>
        <h1 className="text-xl font-medium">{name}</h1>
      </div>

      <div className="flex items-center gap-3">
        {/* Open order tracking */}
        <button
          type="button"
          onClick={onOpenOrders}
          aria-label="Track your orders"
          className="inline-flex items-center justify-center rounded-lg p-1.5 hover:bg-black/5 active:scale-[0.98]"
        >
          <Package size={24} color="#238D9D" weight="duotone" />
        </button>

        {/* Settings */}
        <Link href="/settings" aria-label="Settings">
          <Image src={GearSvg} alt="" />
        </Link>

        {/* Help / Onboarding */}
        <Link href="/onboarding" aria-label="Help & onboarding">
          <Question size={24} color="#238D9D" weight="duotone" />
        </Link>
      </div>
    </div>
  );
}
