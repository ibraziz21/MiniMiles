// src/components/BadgeClaimSuccessSheet.tsx
"use client";

import type { FC } from "react";
import Image from "next/image";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import checkIcon from "@/public/svg/check-icon.svg";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lines like "S1 Transactions • Tier 1" */
  unlocked: string[];
  onContinue?: () => void;
};

export const BadgeClaimSuccessSheet: FC<Props> = ({
  open,
  onOpenChange,
  unlocked,
  onContinue,
}) => {
  const handleContinue = () => {
    onContinue?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="
          fixed
          inset-x-0
          mx-auto
          w-full
          max-w-[420px]
          rounded-t-[24px]
          rounded-b-none
          border-none
          bg-white
          shadow-[0_-10px_30px_rgba(0,0,0,0.15)]
          focus:outline-none
          data-[state=open]:animate-none
        "
        style={{
          top: "auto",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
        }}
      >
        <div className="px-6 pt-6 pb-8">
          {/* drag handle */}
          <div className="mb-6 flex justify-center">
            <div className="h-1 w-16 rounded-full bg-[#E5E7EB]" />
          </div>

          {/* Heading + copy */}
          <h2 className="text-[22px] leading-[28px] tracking-[-0.26px] font-semibold text-black">
            Claim Successful!
          </h2>
          <p className="mt-2 text-[16px] leading-[22px] tracking-[-0.26px] text-[#4B5563]">
            You have unlocked the following badges:
          </p>

          {/* Unlocked list card */}
          {unlocked.length > 0 && (
            <div
              className="
                mt-4
                rounded-[24px]
                border border-[#E5E7EB]
                bg-white
                overflow-hidden
              "
            >
              {unlocked.map((line, idx) => (
                <div
                  key={`${line}-${idx}`}
                  className="
                    flex items-center justify-between
                    px-4 py-3
                    border-b border-[#E5E7EB33]
                    last:border-b-0
                  "
                >
                  <span className="text-[16px] leading-[22px] text-[#4B5563]">
                    {line}
                  </span>
                  <Image
                    src={checkIcon}
                    alt="Unlocked"
                    width={18}
                    height={18}
                    className="h-[18px] w-[18px]"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Continue button */}
          <button
            type="button"
            onClick={handleContinue}
            className="
              mt-6
              flex
              h-14
              w-full
              items-center
              justify-center
              rounded-[16px]
              bg-[#238D9D1A]
              text-base
              font-medium
              text-[#238D9D]
            "
          >
            Continue
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
