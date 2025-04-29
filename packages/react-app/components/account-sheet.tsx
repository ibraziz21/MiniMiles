import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { User } from "@/lib/svg"
import { ActionPill } from "./action-pill"


import React from 'react'
import { Copy } from "@phosphor-icons/react"

const AccountSheet = () => {
    return (
        <Sheet >
            <SheetTrigger className="w-full">
                <ActionPill
                    icon={User}
                    label="My account"
                />
            </SheetTrigger>
            <SheetContent side={"bottom"} className="bg-white rounded-t-xl font-poppins">
                <SheetHeader>
                    <SheetTitle>Account</SheetTitle>
                    <div className="flex flex-col  justify-between items-start shadow-lg rounded-xl p-2 text-[#00000080]">
                        <h3 className="text-sm text-left">Username</h3>
                        <div className="flex justify-between items-center w-full">
                            <h2 className="font-bold">username.mini</h2>
                            <Copy size={24} />
                        </div>
                    </div>
                    <div className="flex flex-col justify-between items-start shadow-lg rounded-xl p-2 text-[#00000080]">
                        <h3 className="text-sm text-left">Paired address</h3>
                        <div className="flex justify-between items-center w-full">
                            <h2 className="font-bold">0xA56..78E3</h2>
                            <Copy size={24} />
                        </div>
                    </div>
                    <div
                        className="w-full rounded-2xl py-4 flex items-center justify-center gap-3 font-semibold tracking-wide shadow-sm text-[#07955F] bg-[#07955F1A] hover:bg-[#07955F1A]
                    disabled:bg-[#07955F1A]"
                    >
                        <span>Close</span>
                    </div>
                </SheetHeader>
            </SheetContent>
        </Sheet >
    )
}

export default AccountSheet