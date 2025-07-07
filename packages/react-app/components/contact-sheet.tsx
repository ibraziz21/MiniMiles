import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { ChatBubble, User } from "@/lib/svg"
import { ActionPill } from "./action-pill"


import React from 'react'
import { Chats, Copy, Envelope, Link } from "@phosphor-icons/react"

const ContactSheet = () => {
    return (
        <Sheet >
            <SheetTrigger className="w-full">
                <ActionPill
                    icon={ChatBubble}
                    label="Contact us"
                />
            </SheetTrigger>
            <SheetContent side={"bottom"} className="bg-white rounded-t-xl font-sterling">
                <SheetHeader>
                    <SheetTitle>Contact us</SheetTitle>
                    <div className="flex justify-between items-start shadow-lg rounded-xl p-2 text-[#00000080]">
                        <Envelope size={24} className="mr-2" color="#238D9D" />
                        <div className="flex justify-between items-center w-full">
                            <h2 className="font-medium">support@akibaMiles.co</h2>
                            <Copy size={24} />
                        </div>
                    </div>
                    <div className="flex justify-between items-start shadow-lg rounded-xl p-2 text-[#00000080]">
                        <Chats size={24} className="mr-2" color="#238D9D" />
                        <div className="flex justify-between items-center w-full">
                            <h2 className="font-medium">Chat with Us</h2>
                            <Link size={24} />
                        </div>
                    </div>
                    <div
                        className="w-full rounded-2xl py-4 flex items-center justify-center gap-3 font-medium tracking-wide shadow-sm text-[#238D9D]  bg-[#238D9D1A] hover:bg-[#238D9D1A]
                    disabled:bg-[#238D9D1A]"
                    >
                        <span>Close</span>
                    </div>
                </SheetHeader>
            </SheetContent>
        </Sheet >
    )
}

export default ContactSheet