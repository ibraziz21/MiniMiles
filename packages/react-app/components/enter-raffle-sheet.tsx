"use client";

import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet";
import { User } from "@/lib/svg";
import { ActionPill } from "./action-pill";

import React, { useEffect } from "react";
import { Copy, Question } from "@phosphor-icons/react";
import { useWeb3 } from "@/contexts/useWeb3";
import { toast, Toaster } from "sonner";

const EnterRaffleSheet = () => {
    return (
        <Sheet>
            <SheetTrigger className="w-full">
                <button
                    className="w-full p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"
                >
                    <Question size={24} />
                    <h3>How to enter a raffle?</h3>
                </button>
            </SheetTrigger>
            <SheetContent
                side={"bottom"}
                className="bg-white rounded-t-xl font-poppins"
            >
                <SheetHeader>
                    <SheetTitle>How to enter raffles</SheetTitle>
                    <div className="flex flex-col justify-between items-start text-[#00000080]">
                        <p className="flex justify-between items-center w-full">
                            With your earned MiniMiles you can buy tickets of raffles. The more tickets you buy the higher your chances are to win big.
                        </p>
                    </div>

                    <button
                        className="p-3 rounded-xl flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A] disabled:bg-[#07955F]"
                    >
                    
                       Close
                    </button>
                </SheetHeader>
            </SheetContent>
        </Sheet>
    );
};

export default EnterRaffleSheet;
