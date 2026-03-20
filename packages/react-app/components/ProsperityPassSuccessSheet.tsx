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
                {/* Outer padding = 24 / 24 / 32 */}
                <div className="px-6 pt-6 pb-8">
                    {/* drag handle */}
                    <div className="mb-6 flex justify-center">
                        <div className="h-1 w-16 rounded-full bg-[#E5E7EB]" />
                    </div>

                    {/* Inner column constrained to 312px like figma */}
                    <div className="mx-auto flex w-full max-w-[312px] flex-col gap-8">
                        {/* Text + icon block */}
                        <div className="relative">
                            {/* icon floats in top-right, no effect on text width */}
                            <Image
                                src={ppSuccess}
                                alt=""
                                width={32}
                                height={32}
                                className="absolute right-0 -top-1 h-8 w-8"
                            />


                            <h2 className="text-[22px] leading-[28px] tracking-[-0.26px] font-semibold text-black">
                                Claim Successful!
                            </h2>
                            <p className="mt-2 text-[16px] leading-[22px] tracking-[-0.26px] text-[#4B5563]">
                                Success, you just claimed your Prosperity Pass and can now start
                                earning badges.
                            </p>
                        </div>

                        {/* Button */}
                        <button
                            type="button"
                            className="
      h-14
      w-full
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
                </div>
            </DialogContent>
        </Dialog>
    );
};
