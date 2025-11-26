// src/components/success-modal.tsx
"use client";

import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Player } from "@lottiefiles/react-lottie-player";
import lottieSuccess from "@/public/json/success.json";
import { Button } from "./ui/button";

const SuccessModal = ({
  openSuccess,
  setOpenSuccess,
}: {
  openSuccess: boolean;
  setOpenSuccess: (c: boolean) => void;
}) => {
  const handleClose = () => setOpenSuccess(false);

  return (
    <Dialog open={openSuccess} onOpenChange={setOpenSuccess}>
      <DialogContent
        className="
          max-w-sm w-[90vw]
          rounded-3xl
          border border-[#E2F6F5]
          bg-white
          p-0
          overflow-hidden
        "
      >
        {/* Top pill / header */}
        <div className="px-6 pt-5">
          <DialogHeader className="items-center">
            <span className="inline-flex items-center rounded-full bg-[#E6FBF4] px-3 py-1 text-xs font-medium text-[#15803d]">
              ✅ Quest Completed
            </span>

            <DialogTitle className="mt-3 text-center text-xl font-semibold text-gray-900">
              Claimed Successfully
            </DialogTitle>

            <p className="mt-1 text-center text-sm text-gray-500">
              Your AkibaMiles have been added to your balance.
            </p>
          </DialogHeader>
        </div>

        {/* Lottie animation */}
        <div className="mt-2 flex items-center justify-center">
          <Player
            keepLastFrame
            autoplay
            src={lottieSuccess}
            style={{ height: "180px", width: "180px" }}
          />
        </div>

        {/* Footer button */}
        <div className="px-6 pb-5">
          <Button
            onClick={handleClose}
            className="
              mt-2 w-full rounded-xl
              bg-[#238D9D]
              text-white
              py-3
              text-sm font-medium
              hover:bg-[#1b6b76]
            "
            title="Done"
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default SuccessModal;
