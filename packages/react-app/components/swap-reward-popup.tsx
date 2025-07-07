import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useState } from "react";

interface SwapRewardPopupProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }

export default function SwapRewardPopup({ open, onOpenChange }: SwapRewardPopupProps) {

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-sm rounded-2xl p-0 overflow-hidden">
                <div className="bg-white">
                    <div className="px-6 pt-6">
                        <DialogHeader>
                            <DialogTitle className="text-lg font-medium text-gray-900">
                                Swap on ReFi DEX
                            </DialogTitle>
                        </DialogHeader>
                    </div>

                    <div className="bg-[#238D9D] text-white text-center py-8">
                        <h2 className="text-4xl font-medium">10 MiniMiles</h2>
                    </div>

                    <div className="px-6 py-4">
                        <h3 className="text-gray-500 text-sm font-medium mb-4">Instructions</h3>
                        <ol className="list-decimal list-inside space-y-2 text-gray-800 text-sm">
                            <li>Swap &gt; 10 USD worth of tokens</li>
                            <li>Only claimable once</li>
                            <li>Between Aug - Dec</li>
                        </ol>
                    </div>

                    <div className="px-6 pb-6">
                        <Button title="Close"
                            onClick={() => { }} className="w-full bg-[#238D9D] hover:bg-[#238D9D] text-white">
                            Swap & earn 10x
                        </Button>
                        <p className="text-center text-[10px] text-gray-400 mt-2">
                            Valid until xx/xx/xx. These terms apply.
                        </p>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
