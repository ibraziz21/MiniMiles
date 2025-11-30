// components/game-card.tsx
"use client";

import { Lock } from "@phosphor-icons/react";
import Image, { type StaticImageData } from "next/image";

type GameCardProps = {
  name: string;
  date: string;
  image: StaticImageData;
  locked?: boolean;
  isNew?: boolean;
};

export const GameCard = ({ name, date, image, locked, isNew }: GameCardProps) => (
  <div className="relative rounded-2xl overflow-hidden bg-black w-[160px] border border-[#ADF4FF80] shrink-0">
    {/* Background image */}
    <Image
      src={image}
      alt={name}
      width={160}
      height={160}
      className={`h-[120px] w-full object-cover ${
        locked ? "opacity-60 blur-[1px]" : "opacity-90"
      }`}
    />

    {/* New badge – only for live games */}
    {isNew && !locked && (
      <div className="absolute top-2 left-2 rounded-full bg-emerald-500/95 px-2 py-0.5 text-[10px] font-semibold text-white shadow-md flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-white" />
        New
      </div>
    )}

    {/* Locked overlay */}
    {locked && (
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white text-center px-2">
        <div className="bg-white/90 rounded-full flex items-center px-2 py-1 mb-2">
          <Lock size={14} color="#238D9D" weight="bold" className="mr-1" />
          <span className="text-[11px] text-[#238D9D] font-medium">
            Coming Soon
          </span>
        </div>
        <p className="text-[11px] text-slate-100">
          {name} will unlock in a future update.
        </p>
      </div>
    )}

    {/* Bottom label */}
    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-2.5 py-2">
      <p className="text-[13px] font-semibold text-white truncate">
        {name}
      </p>
      <p className="text-[11px] text-slate-200 truncate">{date}</p>
    </div>
  </div>
);
