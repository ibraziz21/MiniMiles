// src/components/BadgeCard.tsx
"use client";

import type { FC } from "react";
import Image, { type StaticImageData } from "next/image";

type BadgeCardProps = {
  title: string;
  description: string;
  activeIcon: StaticImageData;
  inactiveIcon: StaticImageData;
  totalSteps?: number;
  completedSteps?: number;
  onClick?: () => void;
};

export const BadgeCard: FC<BadgeCardProps> = ({
  title,
  description,
  activeIcon,
  inactiveIcon,
  totalSteps = 4,
  completedSteps = 0,
  onClick,
}) => {
  const clampedCompleted = Math.max(
    0,
    Math.min(totalSteps, completedSteps ?? 0)
  );

  const isEmpty = clampedCompleted === 0;
  const isCompleted = clampedCompleted >= totalSteps;
  const iconSrc = isEmpty ? inactiveIcon : activeIcon;

  return (
    <button
      type="button"
      onClick={onClick}
      className="
        flex
        h-[213px]
        w-[174px]
        flex-shrink-0           /* ✅ keep width when in horizontal scroll */
        flex-col
        items-center
        justify-between
        rounded-[16px]
        border
        border-[#238D9D4D]
        bg-white
        p-4
        shadow-[0_6px_8px_0_rgba(0,0,0,0.15)]
        text-left
      "
    >
      {/* container: icon + text */}
      <div className="flex h-[143px] w-[142px] flex-col items-center gap-4">
        <div className="flex h-[42px] w-[42px] items-center justify-center">
          <Image
            src={iconSrc}
            alt={title}
            width={42}
            height={42}
            className={
              "h-[42px] w-[42px]" +
              (isEmpty ? " opacity-30 mix-blend-luminosity" : "")
            }
          />
        </div>

        <div className="flex flex-col items-center text-center">
          <h3 className="text-[16px] leading-[24px] tracking-[-0.26px] font-medium text-black">
            {title}
          </h3>
          <p className="mt-1 text-[12px] leading-[20px] tracking-[-0.26px] text-[#9CA3AF]">
            {description}
          </p>
        </div>
      </div>

      <div className="flex w-[142px] justify-center">
        {isCompleted ? (
          <div className="flex items-center gap-2 rounded-full bg-[#D1FAE5] px-3 py-1">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#10B981] text-xs text-white">
              ✓
            </span>
            <span className="text-[13px] font-medium text-[#065F46]">
              Completed
            </span>
          </div>
        ) : (
          <div className="flex h-[6px] w-[142px] items-center justify-between gap-[6px]">
            {Array.from({ length: totalSteps }).map((_, idx) => {
              const filled = idx < clampedCompleted;
              const bg = isEmpty
                ? "#E5E7EB"
                : filled
                ? "#16A34A"
                : "#D1D5DB";

              return (
                <span
                  key={idx}
                  className="h-[6px] flex-1 rounded-full"
                  style={{ backgroundColor: bg }}
                />
              );
            })}
          </div>
        )}
      </div>
    </button>
  );
};
