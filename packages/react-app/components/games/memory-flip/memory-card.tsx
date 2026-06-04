"use client";

import type React from "react";
import { Drop, Key, Leaf, Lightning, Moon, Sparkle, Star, Sun } from "@phosphor-icons/react";

const icons: Record<string, React.ReactNode> = {
  sun:   <Sun       size={28} weight="duotone" />,
  bolt:  <Lightning size={28} weight="duotone" />,
  leaf:  <Leaf      size={28} weight="duotone" />,
  gem:   <Star      size={28} weight="duotone" />,
  wave:  <Drop      size={28} weight="duotone" />,
  key:   <Key       size={28} weight="duotone" />,
  moon:  <Moon      size={28} weight="duotone" />,
  spark: <Sparkle   size={28} weight="duotone" />,
};

export function MemoryCard({
  value,
  visible,
  matched,
  onClick,
  disabled,
}: {
  value: string;
  visible: boolean;
  matched: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || matched}
      className={[
        "aspect-square rounded-2xl [perspective:700px] transition-transform duration-100",
        !matched && !disabled ? "active:scale-90" : "",
        matched ? "scale-95" : "",
      ].join(" ")}
      aria-label={visible ? "Revealed card" : "Hidden card"}
    >
      <div
        className={[
          "relative h-full w-full rounded-2xl transition-transform duration-300 [transform-style:preserve-3d]",
          visible ? "[transform:rotateY(180deg)]" : "",
        ].join(" ")}
      >
        {/* Back face — hidden state */}
        <div className="absolute inset-0 flex items-center justify-center rounded-2xl border-2 border-[#5B35A040] bg-gradient-to-br from-[#3B1F6E] to-[#7B4CC0] text-white [backface-visibility:hidden]">
          <span className="text-base font-bold text-white/60">?</span>
        </div>

        {/* Front face — revealed / matched */}
        <div
          className={[
            "absolute inset-0 flex items-center justify-center rounded-2xl border-2 [backface-visibility:hidden] [transform:rotateY(180deg)]",
            matched
              ? "bg-[#F0FFF6] border-[#138A4566] text-[#138A45] ring-2 ring-[#31C76A60]"
              : "bg-[#F5F0FF] border-[#7B4CC033] text-[#5B35A0]",
          ].join(" ")}
        >
          {icons[value]}
        </div>
      </div>
    </button>
  );
}
