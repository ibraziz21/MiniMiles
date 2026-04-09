// src/components/dashboard-header.tsx
import { GearSvg } from "@/lib/svg";
import { Fire, Question, Trophy } from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";

export default function DashboardHeader({
  name,
  onOpenWinners,
  onOpenStreaks,
  streakCount = 0,
  claimableStreakCount = 0,
  urgentStreakCount = 0,
}: {
  name: any;
  onOpenWinners?: () => void;
  onOpenStreaks?: () => void;
  streakCount?: number;
  claimableStreakCount?: number;
  urgentStreakCount?: number;
}) {
  const initials = name && typeof name === 'string' && name.trim()
    ? name.trim().split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const hasActivity = claimableStreakCount > 0 || streakCount > 0;
  const isUrgent = urgentStreakCount > 0;
  const isClaimable = claimableStreakCount > 0;

  // Badge count: claimable takes priority over active
  const badgeCount = claimableStreakCount > 0 ? claimableStreakCount : streakCount;

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
        <button
          type="button"
          onClick={onOpenStreaks}
          aria-label="View active streaks"
          className="relative inline-flex items-center justify-center rounded-lg p-1.5 hover:bg-black/5 active:scale-[0.98]"
        >
          {/* Pulse ring when urgent or claimable */}
          {(isUrgent || isClaimable) && (
            <span
              className={[
                "absolute inset-0 rounded-lg animate-ping opacity-30",
                isUrgent ? "bg-amber-400" : "bg-[#238D9D]",
              ].join(" ")}
              style={{ animationDuration: isUrgent ? "1s" : "2s" }}
            />
          )}

          <Fire
            size={24}
            weight="duotone"
            color={isUrgent ? "#D97706" : isClaimable ? "#238D9D" : streakCount > 0 ? "#238D9D" : "#9CA3AF"}
          />

          {hasActivity && (
            <span
              className={[
                "absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-bold leading-none text-white",
                isUrgent ? "bg-amber-500" : "bg-[#238D9D]",
              ].join(" ")}
            >
              {badgeCount}
            </span>
          )}
        </button>

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
