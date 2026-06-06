"use client";

import { ChevronLeft } from "lucide-react";

type CrackPotHeaderProps = {
  onBack: () => void;
};

export function CrackPotHeader({ onBack }: CrackPotHeaderProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      <button
        onClick={onBack}
        className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
        aria-label="Back"
      >
        <ChevronLeft className="w-5 h-5 text-slate-600" />
      </button>
      <div className="flex-1">
        <h1 className="text-xl font-black tracking-tight text-slate-900">CrackPot</h1>
        <p className="text-xs text-slate-400">Crack the code. Win the pot.</p>
      </div>
      <div className="text-2xl">🫙</div>
    </div>
  );
}
