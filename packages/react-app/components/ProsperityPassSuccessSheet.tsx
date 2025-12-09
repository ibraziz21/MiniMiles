// src/components/ProsperityPassSuccessSheet.tsx
"use client";

import type { FC } from "react";
import Image from "next/image";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import ppSuccess from "@/public/svg/pp-success.svg";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
};

export const ProsperityPassSuccessSheet: FC<Props> = ({
  open,
  onOpenChange,
  onDone,
}) => {
  const handleDone = () => {
    onDone?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // bottom sheet style
        className="
          fixed
          bottom-0
          left-0
          right-0
          mx-auto
          max-w-sm
          translate-y-0
          rounded-t-[24px]
          rounded-b-none
          border-none
          bg-white
          px-6
          pt-6
          pb-8
          shadow-[0_-10px_30px_rgba(0,0,0,0.15)]
          data-[state=open]:animate-none
        "
      >
        {/* drag handle */}
        <div className="mb-6 flex justify-center">
          <div className="h-1 w-16 rounded-full bg-[#E5E7EB]" />
        </div>

        {/* Text + icon area (312 x 82, gap 10px) */}
        <div className="flex w-full max-w-[312px] items-start justify-between gap-3">
          <div>
            <h2 className="text-[22px] leading-[28px] tracking-[-0.26px] font-semibold text-black">
              Claim Successful!
            </h2>
            <p className="mt-2 text-[16px] leading-[22px] tracking-[-0.26px] text-[#4B5563]">
              Success, you just claimed your Prosperity Pass and can now start
              earning badges.
            </p>
          </div>

          <Image
            src={ppSuccess}
            alt=""
            width={32}
            height={32}
            className="mt-1 h-8 w-8"
          />
        </div>

        {/* Button area (gap 32px from text) */}
        <div className="mt-8 flex w-full justify-center">
          <button
            type="button"
            className="
              flex
              h-14
              w-full
              max-w-[312px]
              items-center
              justify-center
              rounded-[16px]
              bg-[#238D9D1A]
              px-6
              text-base
              font-medium
              text-[#238D9D]
            "
            onClick={handleDone}
          >
            Done
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
