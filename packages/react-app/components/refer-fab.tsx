"use client";

import { useState, useCallback } from "react";
import { ShareNetwork } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useWeb3 } from "@/contexts/useWeb3";
import ReferDialog from "./refer-dialog";

export default function ReferFab() {
  const { address } = useWeb3();
  const [open, setOpen] = useState(false);

  const { data: code } = useQuery({
    queryKey: ["referralCode", address?.toLowerCase()],
    enabled: !!address,
    queryFn: async () =>
      fetch(`/api/referral/code?address=${address}`)
        .then((r) => r.json())
        .then((j) => j.code as string),
    staleTime: 5 * 60_000,
  });

  const onClick = useCallback(() => setOpen(true), []);

  if (!code) return null;

  return (
    <>
      <button
        onClick={onClick}
        className="fixed bottom-24 right-4 z-50 flex items-center gap-2 rounded-full px-4 py-3 bg-[#238D9D] text-white shadow-lg active:scale-95 transition"
        aria-label="Refer & earn"
      >
        <ShareNetwork size={20} weight="bold" />
        <span className="text-sm font-medium">Refer</span>
      </button>

      <ReferDialog open={open} onOpenChange={setOpen} code={code} />
    </>
  );
}
