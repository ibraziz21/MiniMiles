// src/components/BadgesSection.tsx
"use client";

import { useRouter } from "next/navigation";
import { BadgeCard } from "@/components/badge-card";
import {
  BADGES,
  type BadgeProgress,
  EMPTY_BADGE_PROGRESS,
} from "@/lib/prosperityBadges";

type Props = {
  /** Map badge.key -> RAW metric (tx count / AkibaMiles), not steps */
  progress?: BadgeProgress;
};

export function BadgesSection({ progress }: Props) {
  const router = useRouter();
  const safeProgress = progress ?? EMPTY_BADGE_PROGRESS;


  return (
    <div className="mt-6">
      <div className="flex gap-3 overflow-x-auto px-4 pb-2">
        {BADGES.map((b) => {
          // RAW metric value for this badge (e.g. 73 tx, 2400 Miles, etc.)
          const raw = safeProgress[b.key] ?? 0;

          // Number of tiers whose threshold is satisfied by this raw value
          const completedSteps = b.tiers.filter(
            (t) => raw >= t.threshold
          ).length;

      

          return (
            <BadgeCard
              key={b.key}
              title={b.title}
              description={b.shortDescription}
              activeIcon={b.activeIcon}
              inactiveIcon={b.inactiveIcon}
              totalSteps={b.tiers.length}
              completedSteps={raw}
              onClick={() =>
                // Pass the RAW metric to the detail page
                router.push(`/badges/${b.key}?progress=${raw}`)
              }
            />
          );
        })}
      </div>
    </div>
  );
}
