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
import { useWeb3 } from "@/contexts/useWeb3";
import { Loader2 } from "lucide-react";

export default function QuestLoadingModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) 


{
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm rounded-3xl p-0 overflow-hidden">
      <div className="p-6 flex flex-col items-center justify-center h-64 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-green-600 mb-4" />
        <p className="text-sm text-gray-600">Processing your reward…</p>
      </div>
    </DialogContent>
  </Dialog>
  );
}
