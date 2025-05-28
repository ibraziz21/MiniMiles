
"use client";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CalendarIcon, TicketIcon } from "lucide-react";

export default function WinningModal({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="bg-white max-w-sm rounded-3xl p-0 overflow-hidden">
                <div className="text-center px-6 pt-6">
                    <DialogHeader>
                        <DialogTitle className="text-left text-xl font-medium">You won!</DialogTitle>
                    </DialogHeader>

                    <div className="bg-gradient-to-t from-gray-300 to-white w-full rounded-xl py-6 mt-4">
                        <p className="text-3xl font-medium">$500 USDT</p>
                    </div>

                    <p className="text-sm text-gray-500 mt-4 mb-6">
                        500 USDT has been deposited in your MiniPay wallet
                    </p>

                    <div className="flex items-center gap-3 mb-3 text-left w-full">
                        <TicketIcon className="text-gray-500" size={20} />
                        <div>
                            <p className="font-medium text-sm">Weekly USDT raffle</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 text-left w-full">
                        <CalendarIcon className="text-gray-500" size={20} />
                        <div>
                            <p className="font-medium text-sm">Draw Date: Dec 25</p>
                        </div>
                    </div>
                </div>

                <DialogFooter className="flex flex-col items-center px-6 my-6">
                    <Button
                        title="Blockchain receipt" onClick={() => { }}
                        variant="outline"
                        className="w-full border-black text-black font-medium hover:bg-black rounded-lg p-2"
                    >
                        Blockchain receipt
                    </Button>
                    <Button
                        title="Close"
                        onClick={() => onOpenChange(false)}
                        className="w-full bg-green-100 text-green-700 font-medium"
                    >
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
