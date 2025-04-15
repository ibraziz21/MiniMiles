// components/QuestDetailModal.tsx
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export default function QuestDetailModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl p-0 overflow-hidden">
        <div className="p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold">Swap on ReFi DEX</DialogTitle>
          </DialogHeader>

          <div className="bg-green-700 text-white rounded-xl py-4 text-center mt-4">
            <p className="text-2xl font-bold">10 MiniMiles</p>
          </div>

          <div className="mt-6 text-sm space-y-3">
            <p><strong>Instructions</strong></p>
            <ul className="list-decimal list-inside text-gray-700">
              <li>Swap &gt; 10 USD worth of tokens</li>
              <li>Only claimable once</li>
              <li>Between Aug - Dec</li>
            </ul>
          </div>

          <DialogFooter className="mt-6 flex flex-col gap-3">
            <Button title="Swap & earn 10x" onClick={() => { }} className="w-full bg-green-600 hover:bg-green-700">
              
            </Button>
            <p className="text-xs text-gray-500 text-center">Valid until xx/xx/xx. These terms apply.</p>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
