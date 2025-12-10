// src/components/BadgesSection.tsx
"use client";

import { useRouter } from "next/navigation";
import { BadgeCard } from "@/components/badge-card";
import {
  BADGES,
  type BadgeProgress,
} from "@/lib/prosperityBadges";

type Props = {
  /** Map badge.key -> numeric progress (e.g. tx count) */
  progress?: BadgeProgress;
};

// Dummy demo data:
// - s1-transactions → 0   (0 tiers)
// - s1-volume       → 300 (2 tiers, thresholds: 50, 250, 1000, ...)
// - minipay-activity → 70 (all tiers, thresholds: 3,7,15,30,60)
// - akiba-engagement → 20 (some progress, not full)
const DEMO_PROGRESS: BadgeProgress = {
  "s1-transactions": 0,
  "s1-volume": 300,
  "minipay-activity": 70,
  "akiba-engagement": 20,
};

export function BadgesSection({ progress }: Props) {
  const router = useRouter();
  const safeProgress = progress ?? DEMO_PROGRESS;

  return (
    <div className="mt-6">
      <div className="flex gap-3 overflow-x-auto px-4 pb-2">
        {BADGES.map((b) => {
          const raw = safeProgress[b.key] ?? 0;
          const completedTiers = b.tiers.filter((t) => raw >= t.threshold).length;

          return (
            <BadgeCard
              key={b.key}
              title={b.title}
              description={b.shortDescription}
              activeIcon={b.activeIcon}
              inactiveIcon={b.inactiveIcon}
              totalSteps={b.tiers.length}
              completedSteps={completedTiers}
              onClick={() =>
                router.push(`/badges/${b.key}?progress=${raw}`)
              }
            />
          );
        })}
      </div>
    </div>
  );
}
