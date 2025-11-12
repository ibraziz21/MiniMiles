// src/components/dashboard-header.tsx
import { GearSvg } from "@/lib/svg";
import { Question, Trophy } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";

export default function DashboardHeader({
  name,
  onOpenWinners,
}: {
  name: any;
  onOpenWinners?: () => void;
}) {
  return (
    <div className="px-4 pt-4 flex justify-between items-center">
      <h1 className="text-xl font-medium">Welcome {name}!</h1>

      <div className="flex items-center gap-3">
        {/* Open latest winner modal */}
        <button
          type="button"
          onClick={onOpenWinners}
          aria-label="View latest raffle winner"
          className="inline-flex items-center justify-center rounded-lg p-1.5 hover:bg-black/5 active:scale-[0.98]"
        >
          <Trophy size={24} color="#238D9D" weight="duotone" />
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
