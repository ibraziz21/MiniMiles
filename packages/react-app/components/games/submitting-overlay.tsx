"use client";

import { CircleNotch } from "@phosphor-icons/react";

export function SubmittingOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return (
    <div className="mx-4 flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-[#0D7A8A] to-[#238D9D] px-5 py-4">
      <CircleNotch size={20} className="animate-spin text-white/80" />
      <div>
        <p className="text-sm font-bold text-white">Verifying replay…</p>
        <p className="text-xs text-white/70 font-poppins">Checking your score onchain</p>
      </div>
    </div>
  );
}
