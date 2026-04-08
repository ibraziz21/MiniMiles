"use client";

import { ArrowLeft, ClockCounterClockwise, Info } from "@phosphor-icons/react";
import Link from "next/link";

type Props = {
  urgentCount: number;
  onSessionsOpen: () => void;
  onInfoOpen: () => void;
};

export function ClawHero({ urgentCount, onSessionsOpen, onInfoOpen }: Props) {
  return (
    <div className="flex items-center justify-between px-4 pt-4 pb-2">
      {/* Back */}
      <Link
        href="/"
        className="flex items-center gap-1.5 bg-white/70 backdrop-blur-sm border border-gray-100 rounded-full px-3 py-1.5 text-sm font-medium text-gray-600 shadow-sm"
      >
        <span><ArrowLeft size={15} weight="bold" /></span>
        Back
      </Link>

      {/* Title badge */}
      <div className="flex flex-col items-center">
        <div className="flex items-center gap-1.5 bg-white/80 backdrop-blur-sm border rounded-full px-4 py-1.5 shadow-sm"
          style={{ borderColor: "#238D9D33" }}>
          <span className="text-xs" style={{ color: "#238D9D" }}>✦</span>
          <span className="font-bold text-sm text-gray-800 tracking-tight">Akiba Claw</span>
          <span className="text-white text-[10px] font-semibold rounded-full px-1.5 py-0.5 leading-none"
            style={{ background: "#238D9D" }}>
            Beta
          </span>
        </div>
      </div>

      {/* Right buttons */}
      <div className="flex items-center gap-2">
        {/* Sessions */}
        <button
          onClick={onSessionsOpen}
          className="relative w-9 h-9 rounded-full bg-white/70 backdrop-blur-sm border border-gray-100 flex items-center justify-center shadow-sm"
          aria-label="Sessions"
        >
          <span className="text-gray-600"><ClockCounterClockwise size={17} weight="bold" /></span>
          {urgentCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">
              {urgentCount > 9 ? "9+" : urgentCount}
            </span>
          )}
        </button>

        {/* Info */}
        <button
          onClick={onInfoOpen}
          className="w-9 h-9 rounded-full bg-white/70 backdrop-blur-sm border border-gray-100 flex items-center justify-center shadow-sm"
          aria-label="Info"
        >
          <span className="text-gray-600"><Info size={17} weight="bold" /></span>
        </button>
      </div>
    </div>
  );
}
