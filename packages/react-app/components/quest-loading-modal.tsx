"use client";

import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";

export type QuestStatus = "loading" | "success" | "already" | "ineligible" | "error";

export default function QuestLoadingModal({
  open,
  onOpenChange,
  status = "loading",
  message,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status?: QuestStatus;
  message?: string;
}) {
  const iconMap = {
    loading:    <Loader2   className="h-8 w-8 animate-spin text-green-600 mb-4" />,
    success:    <CheckCircle2 className="h-8 w-8 text-green-600 mb-4" />,
    already:    <CheckCircle2 className="h-8 w-8 text-yellow-500 mb-4" />,  // you can pick an icon you prefer
    ineligible: <XCircle     className="h-8 w-8 text-yellow-500 mb-4" />,
    error:      <XCircle     className="h-8 w-8 text-red-600 mb-4" />,
  };
  
  const defaultMsg = {
    loading:    "Checking Status...",
    success:    "Reward minted successfully!",
    already:    "You already claimed this quest today.",
    ineligible: "Required action not found on‑chain.",
    error:      "Something went wrong.",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm rounded-3xl p-0 overflow-hidden">
        <div className="p-6 flex flex-col items-center justify-center h-64 text-center">
          {iconMap[status]}
          <p className="text-sm text-gray-600">
            {message ?? defaultMsg[status]}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
