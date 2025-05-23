"use client";

import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetClose,
} from "@/components/ui/sheet";
import { Question } from "@phosphor-icons/react";

const EnterRaffleSheet = () => {
  return (
    <Sheet>
      {/* Tell Radix to use our <button> as the trigger, not wrap it */}
      <SheetTrigger asChild>
        <button
          className=" w-full p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"
        >
          <Question size={24} />
          <span>How to enter a raffle?</span>
        </button>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        className="bg-white rounded-t-xl font-poppins p-4"
      >
        <SheetHeader>
          <SheetTitle>How to enter raffles</SheetTitle>
          <p className="text-[#00000080] mt-2">
            With your earned MiniMiles you can buy tickets of raffles. The more
            tickets you buy the higher your chances are to win big.
          </p>
        </SheetHeader>

        {/* Use Radix’s SheetClose asChild to turn this into a close button */}
        <SheetClose asChild>
          <button
            className="mt-6 w-full p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"
          >
            Close
          </button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
};

export default EnterRaffleSheet;
