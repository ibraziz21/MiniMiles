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
import { Copy } from "@phosphor-icons/react";
import { useWeb3 } from "@/contexts/useWeb3";
import { toast, Toaster } from "sonner";

const AccountSheet = () => {
  const { address, getUserAddress } = useWeb3();
  const username = "username.mini"; // or pull from your user state

  /* fetch wallet once */
  useEffect(() => {
    getUserAddress();
  }, [getUserAddress]);

  const handleCopy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard!`);
    } catch {
      toast.error(`Failed to copy ${label}.`);
    }
  };

  return (
    <Sheet>
      <SheetTrigger className="w-full">
        <ActionPill icon={User} label="My account" />
      </SheetTrigger>
      <SheetContent
        side={"bottom"}
        className="bg-white rounded-t-xl font-poppins"
      >
        <SheetHeader>
          <SheetTitle>Account</SheetTitle>

          {/* Username block */}
          <div className="flex flex-col justify-between items-start shadow-lg rounded-xl p-2 text-[#00000080]">
            <h3 className="text-sm text-left">Username</h3>
            <div className="flex justify-between items-center w-full">
              <h2 className="font-bold">{username}</h2>
              <Copy
                size={24}
                className="cursor-pointer"
                onClick={() => handleCopy(username, "Username")}
              />
            </div>
          </div>

          {/* Address block */}
          <div className="flex flex-col justify-between items-start shadow-lg rounded-xl p-2 text-[#00000080] mt-4">
            <h3 className="text-sm text-left">Paired address</h3>
            <div className="flex justify-between items-center w-full">
              <h2 className="font-bold break-all">{address}</h2>
              <Copy
                size={24}
                className="cursor-pointer"
                onClick={() => handleCopy(address!, "Address")}
              />
            </div>
          </div>

          <Toaster position="bottom-center" />
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
};

export default AccountSheet;
