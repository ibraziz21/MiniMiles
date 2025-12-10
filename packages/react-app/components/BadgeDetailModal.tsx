// src/components/BadgeDetailModal.tsx
"use client";

import type { FC } from "react";
import Image from "next/image";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { BadgeDef } from "@/lib/prosperityBadges";
import closeIcon from "@/public/svg/close-pass.svg";
import lockIcon from "@/public/svg/lock-icon.svg";
import checkIcon from "@/public/svg/check-icon.svg";

type BadgeDetailModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  badge: BadgeDef | null;
  progressValue: number; // e.g. 123 transactions
};

export const BadgeDetailModal: FC<BadgeDetailModalProps> = ({
  open,
  onOpenChange,
  badge,
  progressValue,
}) => {
  if (!badge) return null;

  const lastTier = badge.tiers[badge.tiers.length - 1];
  const isCompleted = progressValue >= lastTier.threshold;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // ⭐ bottom sheet styling
        className="
          fixed bottom-0 left-0 right-0
          mx-auto
          w-full max-w-[420px]
          rounded-t-[24px] rounded-b-none
          bg-white
          px-6 pt-6 pb-8
          border-none
          max-h-[90vh]
          overflow-y-auto
          data-[state=open]:animate-in
          data-[state=open]:slide-in-from-bottom
          data-[state=closed]:animate-out
          data-[state=closed]:slide-out-to-bottom
        "
      >
        {/* Top area: icon + heading + close (312 wide) */}
        <div className="flex w-[312px] max-w-full items-start gap-4">
          {/* Icon box 58x58 */}
          <div
            className="
              flex h-[58px] w-[58px]
              items-center justify-center
              rounded-[8px]
              border border-[#E5E7EB]
            "
          >
            <Image
              src={
                isCompleted || progressValue > 0
                  ? badge.activeIcon
                  : badge.inactiveIcon
              }
              alt={badge.title}
              width={38}
              height={38}
              className="h-[38px] w-[38px]"
            />
          </div>

          {/* Title */}
          <div className="flex-1">
            <h2 className="text-[22px] leading-[28px] tracking-[-0.26px] font-semibold text-black">
              {badge.title}
            </h2>
          </div>

          {/* Close */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex h-[58px] w-[24px] items-start justify-end p-[3px]"
          >
            <Image
              src={closeIcon}
              alt="Close"
              width={18}
              height={18}
              className="mt-1"
            />
          </button>
        </div>

        {/* Divider */}
        <div className="mt-4 h-px w-full bg-[#E5E7EB]" />

        {/* Completed banner (full badge done) */}
        {isCompleted && (
          <div className="mt-4 flex w-[312px] max-w-full items-center justify-center rounded-full bg-[#D1FAE5] px-4 py-2">
            <Image
              src={checkIcon}
              alt=""
              width={16}
              height={16}
              className="mr-2 h-4 w-4"
            />
            <span className="text-sm font-medium text-[#065F46]">
              Completed
            </span>
          </div>
        )}

        {/* Description */}
        <p className="mt-4 w-[312px] max-w-full text-[16px] leading-[22px] tracking-[-0.26px] text-[#4B5563]">
          {badge.detailDescription}
        </p>

        {/* Progress header pill */}
        <div
          className="
            mt-4
            flex h-[44px] w-[312px] max-w-full
            items-center justify-between
            rounded-[16px]
            border border-[#D9D9D966]
            px-3
          "
        >
          <span className="text-[14px] font-normal text-[#4B5563]">
            Your Progress:
          </span>
          <span className="text-[14px] font-semibold text-[#111827]">
            {progressValue}{" "}
            <span className="font-normal text-[#6B7280]">
              {badge.unitLabel}
            </span>
          </span>
        </div>

{/* Tier list */}
<div className="mt-4 flex w-full flex-col gap-2 pb-2">
  {badge.tiers.map((tier) => {
    const tierDone = progressValue >= tier.threshold;

    return (
      <div
        key={tier.id}
        className={`
          flex min-h-[88px] w-full items-stretch
          rounded-[16px] border overflow-hidden
          bg-white
          ${tierDone ? "border-[#A7F3D0]" : "border-[#E5E7EB]"}
        `}
      >
        {/* LEFT: icon column */}
        <div
          className={`
            flex h-full w-[48px] flex-shrink-0 items-center justify-center
            px-3
            ${tierDone ? "bg-[#CFF2E5]" : "bg-[#8080801A]"}
          `}
        >
          <Image
            src={tierDone ? checkIcon : lockIcon}
            alt={tierDone ? "Completed" : "Locked"}
            width={18}
            height={18}
            className="h-[18px] w-[18px]"
          />
        </div>

        {/* RIGHT: text side – always white */}
        <div className="flex flex-1 flex-col justify-center bg-white px-3 py-3">
          <p className="text-[12px] leading-[16px] font-medium text-[#9CA3AF]">
            {tier.label} • {tier.usersCompletedLabel}
          </p>
          <p className="mt-1 text-[16px] leading-[22px] font-medium text-[#111827]">
            {tier.requirement}
          </p>
        </div>
      </div>
    );
  })}
</div>




      </DialogContent>
    </Dialog>
  );
};
