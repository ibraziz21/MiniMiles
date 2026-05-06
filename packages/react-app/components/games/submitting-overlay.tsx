"use client";

import { CircleNotch } from "@phosphor-icons/react";

export function SubmittingOverlay({ visible, label }: { visible: boolean; label?: string }) {
  if (!visible) return null;
  return (
    <div className="mx-4 flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-[#0D7A8A] to-[#238D9D] px-5 py-4">
      <CircleNotch size={20} className="animate-spin text-white/80" />
      <div>
        <p className="text-sm font-bold text-white">{label ?? "Verifying result"}</p>
        <p className="text-xs text-white/70 font-poppins">Checking your score…</p>
      </div>
    </div>
  );
}
